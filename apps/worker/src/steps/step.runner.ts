import { Page } from 'playwright';
import { ArtifactCollector } from '../collectors/artifact.collector';
import * as path from 'path';

export type CustomStepHandler = (page: Page, input: Record<string, unknown>) => Promise<unknown>;

type StepInput = Record<string, unknown>;
type PlaywrightOptions = Record<string, unknown>;

export class StepRunner {
  private customHandlers: Record<string, CustomStepHandler> = {};

  constructor(
    private readonly page: Page,
    private readonly collector: ArtifactCollector,
    private readonly baseUrl?: string,
    private readonly variables: Record<string, string> = {},
  ) {}

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

    switch (type) {
      // Navigation
      case 'NAVIGATE': {
        const url = this.requiredString(input, 'url');
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
        if (options) await this.page.click(selector, options);
        else await this.page.click(selector);
        return { clicked: selector };
      }

      case 'DBLCLICK': {
        const selector = this.requiredString(input, 'selector');
        await this.page.dblclick(selector, {
          button: this.string(input.button, 'left') as 'left' | 'right' | 'middle',
          force: this.boolean(input.force, false),
          ...this.playwrightOptions(input),
        });
        return { doubleClicked: selector };
      }

      case 'HOVER': {
        const selector = this.requiredString(input, 'selector');
        const options = this.optionalPlaywrightOptions(input);
        if (options) await this.page.hover(selector, options);
        else await this.page.hover(selector);
        return { hovered: selector };
      }

      case 'FILL': {
        const selector = this.requiredString(input, 'selector');
        const value = this.string(input.value ?? input.text, '');
        const options = this.optionalPlaywrightOptions(input);
        if (options) await this.page.fill(selector, value, options);
        else await this.page.fill(selector, value);
        return { filled: selector };
      }

      case 'TYPE': {
        const text = this.requiredAnyString(input, ['text', 'value']);
        const delay = this.optionalNumber(input.delay);
        const options = { ...(delay !== undefined ? { delay } : {}), ...this.playwrightOptions(input) };
        if (input.selector) {
          await this.page.locator(String(input.selector)).type(text, options);
        } else {
          await this.page.keyboard.type(text, options);
        }
        return { typed: input.selector ?? 'keyboard' };
      }

      case 'CLEAR': {
        const selector = this.requiredString(input, 'selector');
        await this.page.locator(selector).clear(this.playwrightOptions(input));
        return { cleared: selector };
      }

      case 'SELECT': {
        const selector = this.requiredString(input, 'selector');
        const value = input.value ?? input.label ?? input.index;
        if (value === undefined || value === null) throw new Error('SELECT step requires value, label, or index');
        await this.page.selectOption(selector, String(value), this.playwrightOptions(input));
        return { selected: value };
      }

      case 'CHECK': {
        const selector = this.requiredString(input, 'selector');
        await this.page.locator(selector).check({ force: this.boolean(input.force, false), ...this.playwrightOptions(input) });
        return { checked: selector };
      }

      case 'UNCHECK': {
        const selector = this.requiredString(input, 'selector');
        await this.page.locator(selector).uncheck({ force: this.boolean(input.force, false), ...this.playwrightOptions(input) });
        return { unchecked: selector };
      }

      case 'KEYBOARD':
      case 'PRESS_KEY': {
        const key = this.requiredString(input, 'key');
        if (input.selector) await this.page.locator(String(input.selector)).focus();
        const options = this.optionalPlaywrightOptions(input);
        if (options) await this.page.keyboard.press(key, options);
        else await this.page.keyboard.press(key);
        return type === 'PRESS_KEY' ? { pressed: key, target: input.selector ?? 'page' } : { pressed: key };
      }

      case 'SCROLL': {
        if (input.selector) {
          await this.page.locator(String(input.selector)).scrollIntoViewIfNeeded(this.playwrightOptions(input));
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
          const options = input.state || this.hasPlaywrightOptions(input) ? { state, ...this.playwrightOptions(input) } : undefined;
          if (options) await this.page.waitForSelector(String(input.selector), options);
          else await this.page.waitForSelector(String(input.selector));
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
        await this.page.waitForSelector(selector, { state, ...this.playwrightOptions(input) });
        return { waitedForSelector: selector, state };
      }

      // Assertions
      case 'ASSERT_TEXT': {
        const selector = this.requiredString(input, 'selector');
        const expected = this.requiredAnyString(input, ['text', 'expectedText', 'value']);
        const actual = (await this.page.textContent(selector)) ?? '';
        this.assertText(actual, expected, this.string(input.matchMode, 'contains'), this.boolean(input.caseSensitive, true), `Expected "${expected}" not found in "${actual}"`);
        return { found: expected };
      }

      case 'ASSERT_VISIBLE': {
        const selector = this.requiredString(input, 'selector');
        const visible = this.boolean(input.shouldBeVisible ?? input.visible, true);
        await this.page.locator(selector).waitFor({ state: visible ? 'visible' : 'hidden', ...this.playwrightOptions(input) });
        return visible ? { visible: selector } : { hidden: selector };
      }

      case 'ASSERT_VALUE': {
        const selector = this.requiredString(input, 'selector');
        const expected = this.requiredAnyString(input, ['value', 'expectedValue', 'text']);
        const actual = await this.page.locator(selector).inputValue(this.playwrightOptions(input));
        this.assertText(actual, expected, this.string(input.matchMode, 'exact'), this.boolean(input.caseSensitive, true));
        return { value: actual, expected };
      }

      case 'ASSERT_URL': {
        const expected = this.requiredAnyString(input, ['url', 'expectedUrl', 'text']);
        const actual = this.page.url();
        this.assertText(actual, expected, this.string(input.matchMode, 'contains'), this.boolean(input.caseSensitive, true), `Expected URL to contain "${expected}", got "${actual}"`);
        return { url: actual, expected };
      }

      case 'ASSERT_ELEMENT': {
        const selector = this.requiredString(input, 'selector');
        const count = await this.page.locator(selector).count();
        const expectedCount = this.optionalNumber(input.count ?? input.expectedCount);
        if (expectedCount !== undefined ? count !== expectedCount : count === 0) {
          throw new Error(expectedCount !== undefined
            ? `Expected ${expectedCount} elements for "${selector}", found ${count}`
            : `Element "${selector}" not found in DOM`);
        }
        return { found: selector, count };
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

  private playwrightOptions(input: StepInput): PlaywrightOptions {
    return (input.options ?? input.playwrightOptions ?? {}) as PlaywrightOptions;
  }

  private interpolateInput(input: StepInput): StepInput {
    const walk = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return value.replace(/\{\{([^}]+)\}\}/g, (_, key) => this.variables[key] ?? '');
      }
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
      }
      return value;
    };
    return walk(input) as StepInput;
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

  private assertText(actualRaw: string, expectedRaw: string, matchMode: string, caseSensitive: boolean, errorMessage?: string): void {
    const actual = caseSensitive ? actualRaw : actualRaw.toLowerCase();
    const expected = caseSensitive ? expectedRaw : expectedRaw.toLowerCase();
    const pass = matchMode === 'exact'
      ? actual === expected
      : matchMode === 'regex'
        ? new RegExp(expectedRaw, caseSensitive ? undefined : 'i').test(actualRaw)
        : actual.includes(expected);

    if (!pass) {
      throw new Error(errorMessage ?? `Expected ${matchMode} match for "${expectedRaw}", got "${actualRaw}"`);
    }
  }
}

const SUPPORTED_UI_STEP_TYPES = [
  'NAVIGATE', 'WAIT_FOR_NAVIGATION', 'CLICK', 'DBLCLICK', 'HOVER', 'FILL', 'TYPE', 'CLEAR', 'SELECT',
  'CHECK', 'UNCHECK', 'KEYBOARD', 'PRESS_KEY', 'SCROLL', 'WAIT', 'WAIT_MS', 'WAIT_FOR_SELECTOR',
  'ASSERT_TEXT', 'ASSERT_VISIBLE', 'ASSERT_VALUE', 'ASSERT_URL', 'ASSERT_ELEMENT', 'SCREENSHOT',
  'API_REQUEST', 'EXECUTE_SCRIPT', 'CUSTOM',
];
