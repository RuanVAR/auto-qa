import { Page, Locator } from 'playwright';
import { ArtifactCollector } from '../collectors/artifact.collector';
import * as path from 'path';
import { interpolateValue, type InterpolationContext } from './interpolate';
import { assertSafeTargetUrl } from '../utils/ssrf-guard';
import {
  CONFIDENCE_BY_STRATEGY, DEFAULT_HEAL_SENSITIVITY, LOW_CONFIDENCE_CEILING,
  NEVER_HEAL_STEP_TYPES, inferStrategy, type SelectorStrategy,
} from './selector-heal';

export type CustomStepHandler = (page: Page, input: Record<string, unknown>) => Promise<unknown>;

type StepInput = Record<string, unknown>;
type PlaywrightOptions = Record<string, unknown>;

/** How long to probe a candidate for a unique match — not the full action
 *  timeout, we are checking whether it resolves at all, not waiting for the
 *  app. The common case (primary matches immediately) costs nothing extra. */
const PROBE_TIMEOUT_MS = 2000;
const PROBE_INTERVAL_MS = 100;

export type SelectorRung = 'primary' | 'fallback';

export interface Resolution {
  locator: Locator;
  selector: string;
  /** The originally-authored selector, present on every resolution (primary
   *  or fallback) so a heal can be persisted as originalSelector→healedSelector. */
  primarySelector: string;
  rung: SelectorRung;
  fallbackIndex?: number;
  healed: boolean;
  confidence?: number;
  strategy?: SelectorStrategy;
  /** A fallback matched uniquely but was below the confidence floor, or the
   *  run already had a low-confidence resolution — reported so the natural
   *  "element not found" failure carries an explanation instead of a mystery. */
  skipped?: { selector: string; confidence: number; reason: 'below-floor' | 'upstream-uncertainty' };
  /** The give-up threshold fired: a valid, floor-clearing fallback existed but
   *  this step has healed on this exact index too many consecutive times. */
  gaveUp?: { selector: string };
}

export interface HealConfig {
  /** Per-project confidence floor — below this, fail rather than heal. */
  sensitivity?: number;
  /** Called only when a fallback has already cleared the floor, right before
   *  it would be accepted — the give-up check is a live DB read so it is kept
   *  lazy rather than paid on every step. */
  giveUpCheck?: (stepIndex: number) => Promise<boolean>;
}

export class StepRunner {
  private customHandlers: Record<string, CustomStepHandler> = {};
  /** Generator memo cache — see ./interpolate.ts. */
  private readonly generated: Record<string, string> = {};
  /** Set by resolveTarget on the most recent call; read by the executor right
   *  after runStep() returns to decide PASSED vs PASSED_HEALED and whether to
   *  write a SelectorHeal row. Reset at the top of every runStep() call. */
  private lastResolution: Resolution | null = null;
  /** Cascading-heal guard (docs/plan §2.4 rule 3): once any resolution in this
   *  run lands in the `low` confidence bucket — regardless of whether the
   *  project's own (possibly lower) sensitivity let it heal — stop healing for
   *  the remainder of the run. One StepRunner instance is scoped to one run. */
  private runHasLowConfidenceResolution = false;

  constructor(
    private readonly page: Page,
    private readonly collector: ArtifactCollector,
    private readonly baseUrl?: string,
    private readonly variables: Record<string, string> = {},
    private readonly healConfig: HealConfig = {},
  ) {}

  /** Read by the executor immediately after runStep() to persist a heal. */
  getLastResolution(): Resolution | null {
    return this.lastResolution;
  }

  /** Public for STORE step + tests — lets them write back into the bag. */
  setVariable(key: string, value: string): void {
    this.variables[key] = value;
  }
  getVariables(): Record<string, string> {
    return { ...this.variables };
  }

  /** Register a custom step handler by name */
  registerHandler(name: string, fn: CustomStepHandler): void {
    this.customHandlers[name] = fn;
  }

  /**
   * @param ctx Optional contextual info — stepIndex / stepName. Used by the
   *   SCREENSHOT step to attach metadata to the saved artifact so the UI can
   *   render it on the correct step row.
   */
  async runStep(
    step: Record<string, unknown>,
    ctx?: { stepIndex: number; stepName: string },
  ): Promise<unknown> {
    const type = step.type as string;
    const input = this.interpolateInput((step.input ?? {}) as StepInput);
    this.lastResolution = null;
    const stepIndex = ctx?.stepIndex ?? -1;
    // Never heal an assertion (docs/plan §2.4 rule 1) — its failure is a
    // statement about the product, not the selector.
    const neverHeal = NEVER_HEAL_STEP_TYPES.has(type);

    switch (type) {
      // Navigation
      case 'NAVIGATE': {
        const rawUrl = this.requiredString(input, 'url');
        // Resolve relative URLs against the environment baseUrl BEFORE the SSRF
        // guard (mirrors API_REQUEST). page.goto would resolve baseURL on its
        // own, but the guard needs an absolute URL or it rejects "/path".
        const url = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
          ? rawUrl
          : `${(this.baseUrl ?? '').replace(/\/$/, '')}/${rawUrl.replace(/^\//, '')}`;
        await assertSafeTargetUrl(url); // SSRF guard — block cloud-metadata / link-local
        await this.page.goto(url, {
          waitUntil: this.string(input.waitUntil, 'domcontentloaded') as 'load' | 'domcontentloaded' | 'networkidle' | 'commit',
          ...this.playwrightOptions(input),
        });
        return { url: this.page.url() };
      }

      case 'WAIT_FOR_NAVIGATION': {
        const waitUntil = this.string(input.waitUntil, 'load') as 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
        const url = this.string(input.url, '');
        if (url) {
          await this.page.waitForURL(url, { waitUntil, ...this.playwrightOptions(input) });
        } else {
          await this.page.waitForLoadState(waitUntil === 'commit' ? 'domcontentloaded' : waitUntil, this.playwrightOptions(input));
        }
        return { waitedForNavigation: url || waitUntil };
      }

      // Interactions
      case 'CLICK': {
        const selector = this.requiredString(input, 'selector');
        const options = this.actionOptions(input);
        const target = (await this.resolveTarget(input, stepIndex)).locator;
        if (options) await target.click(options);
        else await target.click();
        return { clicked: selector };
      }

      case 'DBLCLICK': {
        const selector = this.requiredString(input, 'selector');
        const target = (await this.resolveTarget(input, stepIndex)).locator;
        await target.dblclick({
          button: this.string(input.button, 'left') as 'left' | 'right' | 'middle',
          force: this.boolean(input.force, false),
          ...this.playwrightOptions(input),
        });
        return { doubleClicked: selector };
      }

      case 'HOVER': {
        const selector = this.requiredString(input, 'selector');
        const options = this.optionalPlaywrightOptions(input);
        const target = (await this.resolveTarget(input, stepIndex)).locator;
        if (options) await target.hover(options);
        else await target.hover();
        return { hovered: selector };
      }

      case 'FILL': {
        const selector = this.requiredString(input, 'selector');
        const value = this.string(input.value ?? input.text, '');
        const options = this.optionalPlaywrightOptions(input);
        const target = (await this.resolveTarget(input, stepIndex)).locator;
        if (options) await target.fill(value, options);
        else await target.fill(value);
        return { filled: selector };
      }

      case 'TYPE': {
        const text = this.requiredAnyString(input, ['text', 'value']);
        const delay = this.optionalNumber(input.delay);
        const options = { ...(delay !== undefined ? { delay } : {}), ...this.playwrightOptions(input) };
        if (input.selector) {
          const target = (await this.resolveTarget(input, stepIndex)).locator;
          await target.pressSequentially(text, options);
        } else {
          await this.page.keyboard.type(text, options);
        }
        return { typed: input.selector ?? 'keyboard' };
      }

      case 'CLEAR': {
        const selector = this.requiredString(input, 'selector');
        const target = (await this.resolveTarget(input, stepIndex)).locator;
        await target.clear(this.playwrightOptions(input));
        return { cleared: selector };
      }

      case 'SELECT': {
        const selector = this.requiredString(input, 'selector');
        const value = input.value ?? input.label ?? input.index;
        if (value === undefined || value === null) throw new Error('SELECT step requires value, label, or index');
        const target = (await this.resolveTarget(input, stepIndex)).locator;
        await target.selectOption(String(value), this.playwrightOptions(input));
        return { selected: value };
      }

      case 'CHECK': {
        const selector = this.requiredString(input, 'selector');
        const target = (await this.resolveTarget(input, stepIndex)).locator;
        await target.check({ force: this.boolean(input.force, false), ...this.playwrightOptions(input) });
        return { checked: selector };
      }

      case 'UNCHECK': {
        const selector = this.requiredString(input, 'selector');
        const target = (await this.resolveTarget(input, stepIndex)).locator;
        await target.uncheck({ force: this.boolean(input.force, false), ...this.playwrightOptions(input) });
        return { unchecked: selector };
      }

      case 'KEYBOARD':
      case 'PRESS_KEY': {
        const key = this.requiredString(input, 'key');
        if (input.selector) await (await this.resolveTarget(input, stepIndex)).locator.focus();
        const options = this.optionalPlaywrightOptions(input);
        if (options) await this.page.keyboard.press(key, options);
        else await this.page.keyboard.press(key);
        return type === 'PRESS_KEY' ? { pressed: key, target: input.selector ?? 'page' } : { pressed: key };
      }

      case 'SCROLL': {
        if (input.selector) {
          await (await this.resolveTarget(input, stepIndex)).locator.scrollIntoViewIfNeeded(this.playwrightOptions(input));
          return { scrolled: input.selector };
        }
        const x = this.number(input.x ?? input.deltaX, 0);
        const y = this.number(input.y ?? input.deltaY, 500);
        await this.page.evaluate(({ scrollX, scrollY }: { scrollX: number; scrollY: number }) => window.scrollBy(scrollX, scrollY), { scrollX: x, scrollY: y });
        return { scrolled: { x, y } };
      }

      // Waits
      case 'WAIT': {
        if (input.selector) {
          const state = this.string(input.state, 'visible') as 'attached' | 'detached' | 'visible' | 'hidden';
          // Waiting for absence (hidden/detached) must never search harder for
          // a fallback — that is guaranteed to produce the wrong answer.
          const negativeState = state === 'hidden' || state === 'detached';
          const target = (await this.resolveTarget(input, stepIndex, { negativeState })).locator;
          await target.waitFor({ state, ...this.playwrightOptions(input) });
          return { waitedForSelector: input.selector, state };
        }
        const ms = this.number(input.ms ?? input.duration, 1000);
        await this.page.waitForTimeout(ms);
        return { waited: ms };
      }

      case 'WAIT_MS': {
        const ms = this.number(input.ms ?? input.duration, 1000);
        await this.page.waitForTimeout(ms);
        return { waited: ms };
      }

      case 'WAIT_FOR_SELECTOR': {
        const selector = this.requiredString(input, 'selector');
        const state = this.string(input.state, 'visible') as 'attached' | 'detached' | 'visible' | 'hidden';
        const negativeState = state === 'hidden' || state === 'detached';
        const target = (await this.resolveTarget(input, stepIndex, { negativeState })).locator;
        await target.waitFor({ state, ...this.playwrightOptions(input) });
        return { waitedForSelector: selector, state };
      }

      // Assertions — web-first: poll until the condition holds or the assertion
      // timeout elapses, so async UI (delayed text, late renders) doesn't cause
      // false failures. (Phase 6d.) Never healed — a failing assertion is a
      // statement about the product, not the selector (docs/plan §2.4).
      case 'ASSERT_TEXT': {
        const selector = this.requiredString(input, 'selector');
        const expected = this.requiredAnyString(input, ['text', 'expectedText', 'value']);
        const matchMode = this.string(input.matchMode, 'contains');
        const cs = this.boolean(input.caseSensitive, true);
        const loc = (await this.resolveTarget(input, stepIndex, { neverHeal })).locator;
        await this.pollUntil(async () => {
          const actual = (await loc.first().textContent()) ?? '';
          return { ok: this.textMatches(actual, expected, matchMode, cs), message: `Expected "${expected}" (${matchMode}) in "${selector}", got "${actual}"` };
        }, this.assertTimeout(input, step));
        return { found: expected };
      }

      case 'ASSERT_VISIBLE': {
        const selector = this.requiredString(input, 'selector');
        const visible = this.boolean(input.shouldBeVisible ?? input.visible, true);
        // Asserting invisibility is a negative assertion on top of already
        // never being healed — belt and braces since NEVER_HEAL_STEP_TYPES
        // already covers ASSERT_VISIBLE.
        const target = (await this.resolveTarget(input, stepIndex, { neverHeal, negativeState: !visible })).locator;
        await target.first().waitFor({ state: visible ? 'visible' : 'hidden', ...this.playwrightOptions(input) });
        return visible ? { visible: selector } : { hidden: selector };
      }

      case 'ASSERT_VALUE': {
        const selector = this.requiredString(input, 'selector');
        const expected = this.requiredAnyString(input, ['value', 'expectedValue', 'text']);
        const matchMode = this.string(input.matchMode, 'exact');
        const cs = this.boolean(input.caseSensitive, true);
        const loc = (await this.resolveTarget(input, stepIndex, { neverHeal })).locator;
        await this.pollUntil(async () => {
          const actual = await loc.first().inputValue();
          return { ok: this.textMatches(actual, expected, matchMode, cs), message: `Expected value "${expected}" (${matchMode}) in "${selector}", got "${actual}"` };
        }, this.assertTimeout(input, step));
        return { value: expected };
      }

      case 'ASSERT_URL': {
        const expected = this.requiredAnyString(input, ['url', 'expectedUrl', 'text']);
        const matchMode = this.string(input.matchMode, 'contains');
        const caseSensitive = this.boolean(input.caseSensitive, true);
        const matches = (u: string): boolean => {
          const a = caseSensitive ? u : u.toLowerCase();
          const e = caseSensitive ? expected : expected.toLowerCase();
          return matchMode === 'exact'
            ? a === e
            : matchMode === 'regex'
              ? new RegExp(expected, caseSensitive ? undefined : 'i').test(u)
              : a.includes(e);
        };
        // SPA navigations/redirects are async — wait for the URL to satisfy the
        // assertion (mirrors Playwright's toHaveURL) instead of reading it once.
        if (!matches(this.page.url())) {
          try {
            await this.page.waitForURL((u) => matches(u.toString()), this.playwrightOptions(input));
          } catch {
            // fall through to a descriptive assertion failure below
          }
        }
        const actual = this.page.url();
        this.assertText(actual, expected, matchMode, caseSensitive, `Expected URL to contain "${expected}", got "${actual}"`);
        return { url: actual, expected };
      }

      case 'ASSERT_ELEMENT': {
        const selector = this.requiredString(input, 'selector');
        const expectedCount = this.optionalNumber(input.count ?? input.expectedCount);
        const loc = (await this.resolveTarget(input, stepIndex, { neverHeal })).locator;
        let count = 0;
        await this.pollUntil(async () => {
          count = await loc.count();
          const ok = expectedCount !== undefined ? count === expectedCount : count > 0;
          return { ok, message: expectedCount !== undefined
            ? `Expected ${expectedCount} elements for "${selector}", found ${count}`
            : `Element "${selector}" not found in DOM` };
        }, this.assertTimeout(input, step));
        return { found: selector, count };
      }

      case 'FILE_UPLOAD': {
        // Upload file(s) to a file input. Content is provided inline so the test
        // is self-contained — no external file needed. (Phase 6b.)
        const selector = this.requiredString(input, 'selector');
        const filesIn = Array.isArray(input.files) ? input.files : [];
        if (filesIn.length === 0) throw new Error('FILE_UPLOAD requires a non-empty files[] array');
        const files = filesIn.map((f) => {
          const file = f as { name?: string; mimeType?: string; content?: string; base64?: boolean };
          const raw = String(file.content ?? '');
          return {
            name: file.name ?? 'upload.bin',
            mimeType: file.mimeType ?? 'application/octet-stream',
            buffer: file.base64 ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8'),
          };
        });
        const target = (await this.resolveTarget(input, stepIndex)).locator;
        await target.setInputFiles(files, this.playwrightOptions(input));
        return { uploaded: files.map((f) => f.name), selector };
      }

      // Value verification + metric emission (Phase 7). Captures a numeric
      // value (often a delta like {{USERS_AFTER}} - {{USERS_BEFORE}}), optionally
      // asserts on it, and emits a named metric the run rolls up + the dashboard
      // aggregates across runs.
      case 'EMIT_METRIC': {
        const name = this.requiredString(input, 'name');
        const rawValue = this.requiredAnyString(input, ['value', 'expression']);
        const value = this.evaluateNumeric(rawValue);
        const assertion = input.assert as { operator?: string; expected?: number; expected2?: number } | undefined;
        if (assertion && assertion.operator) {
          const ok = this.compareNumeric(value, assertion.operator, Number(assertion.expected), assertion.expected2 !== undefined ? Number(assertion.expected2) : undefined);
          if (!ok) {
            throw new Error(`Metric "${name}" = ${value} failed assertion (${assertion.operator} ${assertion.expected}${assertion.expected2 !== undefined ? `, ${assertion.expected2}` : ''})`);
          }
        }
        const aggregation = this.string(input.aggregation, 'sum');
        const unit = typeof input.unit === 'string' ? input.unit : null;
        // The `metric` key on the output is what run.executor collects into
        // TestRun.metadata.emittedMetrics for cross-run aggregation.
        return { metric: { name, value, unit, aggregation } };
      }

      // Artifacts
      case 'SCREENSHOT': {
        // Default name is unique-per-step so users can drop multiple
        // SCREENSHOT steps in a test without collisions.
        const defaultName = ctx
          ? `step-${ctx.stepIndex}-manual-${Date.now()}`
          : `screenshot-${Date.now()}`;
        const name = this.string(input.name ?? input.label, defaultName);
        const filename = name.endsWith('.png') ? name : `${name}.png`;
        const fp = path.join(this.collector.runDir, filename);
        await this.page.screenshot({ path: fp, fullPage: this.boolean(input.fullPage, true), ...this.playwrightOptions(input) });
        await this.collector.register('SCREENSHOT', filename, fp, {
          ...(ctx ? { stepIndex: ctx.stepIndex, stepName: ctx.stepName } : {}),
          trigger: 'manual',
          fullPage: this.boolean(input.fullPage, true),
        });
        return { screenshot: filename };
      }

      // API request through Playwright's request context
      case 'API_REQUEST': {
        const rawUrl = this.requiredString(input, 'url');
        const resolvedUrl = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
          ? rawUrl
          : `${(this.baseUrl ?? '').replace(/\/$/, '')}/${rawUrl.replace(/^\//, '')}`;
        await assertSafeTargetUrl(resolvedUrl); // SSRF guard
        const res = await this.page.request.fetch(resolvedUrl, {
          method: this.string(input.method, 'GET'),
          headers: (input.headers as Record<string, string>) ?? {},
          data: this.requestBody(input.body),
          ...this.playwrightOptions(input),
        });
        const status = res.status();
        const expected = this.number(input.expectedStatus ?? input.status, 200);
        if (status !== expected) throw new Error(`API returned ${status}, expected ${expected}`);
        return { status, url: resolvedUrl };
      }

      // Capture into the variable bag so later steps can interpolate.
      // Pairs with the {{KEY}} interpolation in interpolateInput.
      case 'STORE': {
        const as = this.requiredString(input, 'as');
        const from = this.string(input.from, 'expression');
        let captured: string;
        switch (from) {
          case 'selector-value': {
            const selector = this.requiredString(input, 'selector');
            captured = await this.page.locator(selector).inputValue();
            break;
          }
          case 'selector-text': {
            const selector = this.requiredString(input, 'selector');
            captured = (await this.page.locator(selector).textContent()) ?? '';
            captured = captured.trim();
            break;
          }
          case 'selector-attribute': {
            const selector = this.requiredString(input, 'selector');
            const attr = this.requiredString(input, 'attribute');
            captured = (await this.page.locator(selector).getAttribute(attr)) ?? '';
            break;
          }
          case 'url': {
            captured = this.page.url();
            break;
          }
          case 'url-regex': {
            const regex = this.requiredString(input, 'regex');
            const m = this.page.url().match(new RegExp(regex));
            // group 1 if present, else whole match
            captured = (m?.[1] ?? m?.[0]) ?? '';
            break;
          }
          case 'expression': {
            const script = this.requiredAnyString(input, ['script', 'expression']);
            const result = await this.page.evaluate(
              ({ source }: { source: string }) => {
                const fn = new Function(source) as () => unknown;
                return fn();
              },
              { source: script },
            );
            captured = result === undefined || result === null ? '' : String(result);
            break;
          }
          default:
            throw new Error(`STORE: unknown from="${from}". Supported: selector-value, selector-text, selector-attribute, url, url-regex, expression.`);
        }
        this.setVariable(as, captured);
        return { stored: { [as]: captured } };
      }

      // Escape hatches
      case 'EXECUTE_SCRIPT': {
        const script = this.requiredAnyString(input, ['script', 'code']);
        const args = input.args ?? input.arguments ?? {};
        const result = await this.page.evaluate(
          ({ source, scriptArgs }: { source: string; scriptArgs: unknown }) => {
            const fn = new Function('args', source) as (args: unknown) => unknown;
            return fn(scriptArgs);
          },
          { source: script, scriptArgs: args },
        );
        return { result };
      }

      case 'CUSTOM': {
        const handlerName = input.handler as string | undefined;
        if (handlerName && this.customHandlers[handlerName]) {
          return await this.customHandlers[handlerName](this.page, input);
        }
        throw new Error(
          handlerName
            ? `No custom handler registered for "${handlerName}". Register it via StepRunner.registerHandler().`
            : 'CUSTOM step requires a "handler" input field specifying the handler name.',
        );
      }

      default:
        throw new Error(`Unknown step type: "${type}". Supported UI step types: ${SUPPORTED_UI_STEP_TYPES.join(', ')}`);
    }
  }

  /**
   * Convert an authoring selector string into a real Playwright Locator.
   * Handles getByX(...) API-style strings (which page.locator can't execute)
   * emitted by the AI/DSL, e.g. getByText("Save"), getByRole("button","Save"),
   * getByTestId("x"). Everything else (css, #id, [data-testid=…], role=, text=,
   * xpath) passes straight to page.locator. (Phase 6a — selector normalizer.)
   */
  private normalizeToLocator(sel: string): Locator {
    const m = sel.trim().match(/^getBy(\w+)\((.*)\)$/s);
    if (!m) return this.page.locator(sel);
    const fn = m[1].toLowerCase();
    const argsRaw = m[2];
    const quoted = [...argsRaw.matchAll(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g)].map((x) => x[1] ?? x[2] ?? '');
    const first = quoted[0] ?? '';
    const exact = /\bexact\s*:\s*true\b/.test(argsRaw);
    switch (fn) {
      case 'text': return this.page.getByText(first, exact ? { exact: true } : undefined);
      case 'role': return this.page.getByRole(first as Parameters<Page['getByRole']>[0], quoted[1] ? { name: quoted[1] } : undefined);
      case 'label': return this.page.getByLabel(first, exact ? { exact: true } : undefined);
      case 'placeholder': return this.page.getByPlaceholder(first, exact ? { exact: true } : undefined);
      case 'testid': return this.page.getByTestId(first);
      case 'title': return this.page.getByTitle(first, exact ? { exact: true } : undefined);
      case 'alttext': return this.page.getByAltText(first, exact ? { exact: true } : undefined);
      default: return this.page.locator(sel);
    }
  }

  /** Probe whether a candidate resolves to exactly one element, polling for
   *  up to `timeoutMs` (the element may not have rendered yet) rather than a
   *  one-shot read. Never throws — ambiguous (0 or >1) is just "not this one". */
  private async probeUnique(loc: Locator, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        if ((await loc.count()) === 1) return true;
      } catch {
        /* treat as not-yet-resolved and keep polling */
      }
      if (Date.now() >= deadline) return false;
      await this.page.waitForTimeout(PROBE_INTERVAL_MS);
    }
  }

  /**
   * Resolve a step's target by trying the primary selector, then each
   * fallback in order, recording which rung won. Deliberately ordered rather
   * than `.or()`-unioned: `.or()` does not prefer the left side, so when both
   * the primary and a fallback match, Playwright raises a strict-mode
   * violation instead of using the primary. Ordered resolution also gives us
   * the one thing a union cannot — knowing that the primary FAILED, which is
   * the entire signal selector drift detection is built on.
   *
   * `neverHeal` (assertions) and `negativeState` (waiting for an element to be
   * absent) both skip the cascade entirely and resolve primary-only: an
   * assertion's failure is a statement about the product, and searching
   * harder for an element you expect to be gone is guaranteed to produce the
   * wrong answer. (docs/plan/04-PHASE-2-HEALING.md §2.4, rules 1 and its
   * negative-assertion extension.)
   */
  private async resolveTarget(
    input: StepInput,
    stepIndex: number,
    opts: { neverHeal?: boolean; negativeState?: boolean } = {},
  ): Promise<Resolution> {
    const primary = this.requiredString(input, 'selector');
    const primaryLoc = this.normalizeToLocator(primary);

    if (opts.neverHeal || opts.negativeState) {
      const resolution: Resolution = { locator: primaryLoc, selector: primary, primarySelector: primary, rung: 'primary', healed: false };
      this.lastResolution = resolution;
      return resolution;
    }

    if (await this.probeUnique(primaryLoc, PROBE_TIMEOUT_MS)) {
      const resolution: Resolution = { locator: primaryLoc, selector: primary, primarySelector: primary, rung: 'primary', healed: false };
      this.lastResolution = resolution;
      return resolution;
    }

    const fallbacks = (Array.isArray(input.fallbackSelectors) ? input.fallbackSelectors : [])
      .filter((f): f is string => typeof f === 'string' && f.trim().length > 0);

    const floor = this.healConfig.sensitivity ?? DEFAULT_HEAL_SENSITIVITY;
    let skipped: Resolution['skipped'];

    // Rule 3 — one uncertain resolution earlier in the run poisons everything
    // after it, because every subsequent "successful" heal would be resolving
    // against a context we no longer trust was reached correctly.
    if (this.runHasLowConfidenceResolution) {
      const resolution: Resolution = {
        locator: primaryLoc, selector: primary, primarySelector: primary, rung: 'primary', healed: false,
        skipped: { selector: primary, confidence: 0, reason: 'upstream-uncertainty' },
      };
      this.lastResolution = resolution;
      return resolution;
    }

    for (let i = 0; i < fallbacks.length; i++) {
      const f = fallbacks[i];
      const loc = this.normalizeToLocator(f);
      if (!(await this.probeUnique(loc, PROBE_TIMEOUT_MS))) continue;

      const strategy = inferStrategy(f);
      const confidence = CONFIDENCE_BY_STRATEGY[strategy];

      // Rule 2 — below the project's floor, fail rather than heal through.
      // Skip this candidate (not the whole cascade) — a later, stronger
      // fallback may still clear the floor.
      if (confidence < floor) {
        skipped = skipped ?? { selector: f, confidence, reason: 'below-floor' };
        continue;
      }

      // Give-up (docs/plan §2.4 §2.6): a valid, floor-clearing candidate
      // exists, but this exact step has healed too many consecutive times.
      // Reject it — the step fails naturally below — rather than papering
      // over a selector that has genuinely drifted.
      if (this.healConfig.giveUpCheck && (await this.healConfig.giveUpCheck(stepIndex))) {
        const resolution: Resolution = { locator: primaryLoc, selector: primary, primarySelector: primary, rung: 'primary', healed: false, gaveUp: { selector: f } };
        this.lastResolution = resolution;
        return resolution;
      }

      if (confidence < LOW_CONFIDENCE_CEILING) this.runHasLowConfidenceResolution = true;

      const resolution: Resolution = {
        locator: loc, selector: f, primarySelector: primary, rung: 'fallback', fallbackIndex: i, healed: true, confidence, strategy,
      };
      this.lastResolution = resolution;
      return resolution;
    }

    // Nothing resolved uniquely — return the primary Locator so the caller's
    // own Playwright action throws its natural, familiar error message.
    const resolution: Resolution = { locator: primaryLoc, selector: primary, primarySelector: primary, rung: 'primary', healed: false, skipped };
    this.lastResolution = resolution;
    return resolution;
  }

  /**
   * Assertion timeout (ms), default 5s.
   *
   * Reads BOTH positions, in precedence order:
   *   1. `input.timeout` / `input.timeoutMs` — legacy, honoured by stored steps
   *   2. `step.timeoutMs` — the documented contract (the `Step` type in
   *      packages/shared) and what the step editor actually writes
   *
   * (2) was not read at all, which made the editor's "Timeout (ms)" control a
   * no-op: a user setting 60000 still got the 5s default, with nothing anywhere
   * to explain why the value they typed had no effect.
   */
  private assertTimeout(input: StepInput, step?: Record<string, unknown>): number {
    return (
      this.optionalNumber(input.timeout ?? input.timeoutMs) ??
      this.optionalNumber(step?.timeoutMs) ??
      5000
    );
  }

  /**
   * Poll an async predicate until it passes or the timeout elapses — gives the
   * one-shot assertions web-first retry semantics (no @playwright/test dep).
   * On timeout, throws with the message from the last failing read.
   */
  private async pollUntil(check: () => Promise<{ ok: boolean; message: string }>, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    for (;;) {
      let res: { ok: boolean; message: string };
      try { res = await check(); } catch (e) { res = { ok: false, message: (e as Error).message }; }
      if (res.ok) return;
      last = res.message;
      if (Date.now() >= deadline) throw new Error(last);
      await this.page.waitForTimeout(100);
    }
  }

  private playwrightOptions(input: StepInput): PlaywrightOptions {
    return (input.options ?? input.playwrightOptions ?? {}) as PlaywrightOptions;
  }

  private interpolateInput(input: StepInput): StepInput {
    const ctx: InterpolationContext = { variables: this.variables, generated: this.generated };
    return interpolateValue(input, ctx) as StepInput;
  }

  private optionalPlaywrightOptions(input: StepInput): PlaywrightOptions | undefined {
    return this.hasPlaywrightOptions(input) ? this.playwrightOptions(input) : undefined;
  }

  private hasPlaywrightOptions(input: StepInput): boolean {
    const options = input.options ?? input.playwrightOptions;
    return !!options && typeof options === 'object' && Object.keys(options as Record<string, unknown>).length > 0;
  }

  private actionOptions(input: StepInput): PlaywrightOptions | undefined {
    const options: PlaywrightOptions = { ...this.playwrightOptions(input) };
    if (input.button && input.button !== 'left') options.button = input.button;
    if (input.force === true) options.force = true;
    return Object.keys(options).length ? options : undefined;
  }

  private requiredString(input: StepInput, field: string): string {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
    return value;
  }

  private requiredAnyString(input: StepInput, fields: string[]): string {
    for (const field of fields) {
      const value = input[field];
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
    throw new Error(`${fields.join(' or ')} is required`);
  }

  private string(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
  }

  private number(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private boolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
  }

  private requestBody(body: unknown): unknown {
    if (typeof body !== 'string') return body;
    if (!body.trim()) return undefined;
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  /**
   * Evaluate a numeric value or a simple arithmetic expression (e.g.
   * "15 - 10"). Only digits / . + - * / ( ) / whitespace are allowed, so the
   * Function eval can't reach identifiers — safe for interpolated values.
   */
  private evaluateNumeric(raw: string): number {
    const s = raw.trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (/^[\d\s.+\-*/()]+$/.test(s)) {
      try {
        const val = Function(`"use strict"; return (${s});`)() as unknown;
        if (typeof val === 'number' && Number.isFinite(val)) return val;
      } catch {
        /* fall through */
      }
    }
    throw new Error(`EMIT_METRIC value "${raw}" is not numeric (after interpolation)`);
  }

  private compareNumeric(actual: number, op: string, expected: number, expected2?: number): boolean {
    switch (op) {
      case '==': return actual === expected;
      case '!=': return actual !== expected;
      case '>': return actual > expected;
      case '<': return actual < expected;
      case '>=': return actual >= expected;
      case '<=': return actual <= expected;
      case 'between': return expected2 !== undefined && actual >= Math.min(expected, expected2) && actual <= Math.max(expected, expected2);
      default: return false;
    }
  }

  /** Pure matcher used by the web-first assertions + assertText. */
  private textMatches(actualRaw: string, expectedRaw: string, matchMode: string, caseSensitive: boolean): boolean {
    const actual = caseSensitive ? actualRaw : actualRaw.toLowerCase();
    const expected = caseSensitive ? expectedRaw : expectedRaw.toLowerCase();
    return matchMode === 'exact'
      ? actual === expected
      : matchMode === 'regex'
        ? new RegExp(expectedRaw, caseSensitive ? undefined : 'i').test(actualRaw)
        : actual.includes(expected);
  }

  private assertText(actualRaw: string, expectedRaw: string, matchMode: string, caseSensitive: boolean, errorMessage?: string): void {
    if (!this.textMatches(actualRaw, expectedRaw, matchMode, caseSensitive)) {
      throw new Error(errorMessage ?? `Expected ${matchMode} match for "${expectedRaw}", got "${actualRaw}"`);
    }
  }
}

const SUPPORTED_UI_STEP_TYPES = [
  'NAVIGATE', 'WAIT_FOR_NAVIGATION', 'CLICK', 'DBLCLICK', 'HOVER', 'FILL', 'TYPE', 'CLEAR', 'SELECT',
  'CHECK', 'UNCHECK', 'KEYBOARD', 'PRESS_KEY', 'SCROLL', 'WAIT', 'WAIT_MS', 'WAIT_FOR_SELECTOR',
  'ASSERT_TEXT', 'ASSERT_VISIBLE', 'ASSERT_VALUE', 'ASSERT_URL', 'ASSERT_ELEMENT', 'SCREENSHOT',
  'FILE_UPLOAD', 'API_REQUEST', 'STORE', 'EXECUTE_SCRIPT', 'EMIT_METRIC', 'CUSTOM',
];
