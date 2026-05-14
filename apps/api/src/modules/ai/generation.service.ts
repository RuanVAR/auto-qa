import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AISummaryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiCredentialResolver } from './credential-resolver.service';
import { AiCostCalculator } from './cost-calculator.service';
import { AiQuotaGuard } from './guards/ai-quota.guard';
import { stepsFromTestPrompt } from './prompts/generate/steps-from-test';
import { acFromSourcePrompt } from './prompts/extract/ac-from-source';
import {
  G3Output,
  g3OutputSchema,
  acExtractSchema,
  isStableSelector,
  StepSchema,
} from './prompts/base/output-schemas';
import { SourceBundle } from './prompts/base/source-context-builder';
import { AiModelMeta } from './providers/provider.factory';

export interface GenerateStepsInput {
  testId: string;
  orgId: string;
  userId: string;
  /** Free-text additional context from the modal. */
  extraContext?: string;
}

export interface PhaseEvent {
  phase:
    | 'resolving-credential'
    | 'gathering-sources'
    | 'extracting-ac'
    | 'generating'
    | 'validating'
    | 'complete'
    | 'error';
  message?: string;
  data?: Record<string, unknown>;
}

export interface ProposedStepsResult {
  proposed: G3Output;
  aiSummaryId: string;
  acceptanceCriteria: string[];
  costUsd: number;
  warnings: string[];
}

/**
 * Orchestrates the G1/G2/G3 generation pipeline (G3 implemented in Phase 1,
 * G1/G2 wired here later).
 *
 * For G3 (steps for a test):
 *   1. Quota check via AiQuotaGuard.assert(orgId, userId)
 *   2. Resolve the org's AI credential → AiModelMeta
 *   3. Gather sources (test row + feature row + attached docs + free-text)
 *   4. Pre-call: extract AC from sources (cheap call, fan-out across them)
 *   5. Main call: ask the model for steps, validated against g3OutputSchema
 *   6. Auto-fix: renumber indices, drop selector-unstable steps to
 *      aiDescription-only, default missing continueOnFail / priority
 *   7. Persist AISummary row with prompt + response + tokens + cost +
 *      duration + promptVersion
 *   8. Release the concurrency slot (release() comes from quota check)
 *   9. Return the proposed steps + the AISummary id — DO NOT touch the
 *      TestDefinition yet, the user picks/saves in the preview UI.
 */
@Injectable()
export class AiGenerationService {
  private readonly logger = new Logger(AiGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: AiCredentialResolver,
    private readonly cost: AiCostCalculator,
    private readonly quota: AiQuotaGuard,
  ) {}

  /**
   * Streaming variant: yields phase events as the pipeline progresses.
   * The SSE controller wraps these into `event:` frames. Non-streaming
   * callers can still drain the generator to a final ProposedStepsResult
   * (the last event has phase='complete' with `data.result`).
   */
  async *generateStepsForTest(
    input: GenerateStepsInput,
  ): AsyncGenerator<PhaseEvent, void, void> {
    const { testId, orgId, userId, extraContext } = input;

    yield { phase: 'resolving-credential' };
    const slot = await this.quota.assert(orgId, userId);
    let meta: AiModelMeta;
    try {
      meta = await this.resolver.resolveForOrg(orgId);
    } catch (err) {
      await slot.release();
      throw err;
    }

    try {
      yield { phase: 'gathering-sources' };
      const sources = await this.gatherSources(testId, extraContext);

      // ── AC extraction (cheap pre-call) ──────────────────────────────────
      yield { phase: 'extracting-ac' };
      let acceptanceCriteria: string[] = [];
      try {
        const acPrompt = acFromSourcePrompt(sources.bundle);
        const acResult = await meta.model.invoke([
          { role: 'system', content: acPrompt.system },
          { role: 'user', content: acPrompt.user },
        ]);
        const raw = typeof acResult.content === 'string' ? acResult.content : JSON.stringify(acResult.content);
        const parsed = parseJsonLoose(raw);
        const validated = acExtractSchema.safeParse(parsed);
        if (validated.success) acceptanceCriteria = validated.data.acceptanceCriteria;
        await this.recordSummary({
          orgId,
          type: AISummaryType.AC_EXTRACTION,
          purpose: 'extract',
          promptVersion: acPrompt.promptVersion,
          modelLabel: meta.label,
          provider: meta.provider,
          modelName: meta.modelName,
          prompt: acPrompt.system + '\n\n' + acPrompt.user,
          response: raw,
          usage: extractUsage(acResult),
          durationMs: 0,
        });
      } catch (err) {
        this.logger.warn(`AC extraction failed (continuing without AC): ${(err as Error).message}`);
      }

      // ── Main generation (G3 steps) ──────────────────────────────────────
      yield { phase: 'generating', data: { model: meta.label, acFound: acceptanceCriteria.length } };
      const prompt = stepsFromTestPrompt({
        testName: sources.test.name,
        testDescription: sources.test.description,
        existingSteps: sources.existingSteps,
        acceptanceCriteria,
        sources: sources.bundle,
      });

      const t0 = Date.now();
      const result = await meta.model.invoke([
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ]);
      const durationMs = Date.now() - t0;
      const rawResponse = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      const responseUsage = extractUsage(result);

      // ── Validation + auto-fix ───────────────────────────────────────────
      yield { phase: 'validating' };
      const { proposed, warnings } = this.parseAndAutoFix(rawResponse);

      // ── Persist AISummary ───────────────────────────────────────────────
      const costUsd = this.calcCost(meta, responseUsage);
      const summary = await this.recordSummary({
        orgId,
        type: AISummaryType.TEST_GENERATION,
        purpose: 'g3',
        promptVersion: prompt.promptVersion,
        modelLabel: meta.label,
        provider: meta.provider,
        modelName: meta.modelName,
        prompt: prompt.system + '\n\n' + prompt.user,
        response: rawResponse,
        usage: responseUsage,
        durationMs,
        costUsd,
      });

      yield {
        phase: 'complete',
        data: {
          result: {
            proposed,
            aiSummaryId: summary?.id ?? '',
            acceptanceCriteria,
            costUsd,
            warnings,
          } satisfies ProposedStepsResult,
        },
      };
    } finally {
      await slot.release();
    }
  }

  /**
   * Load the test row + its feature/module/project chain + attached docs
   * + linked tickets so the prompt has everything it needs.
   */
  private async gatherSources(
    testId: string,
    extraContext?: string,
  ): Promise<{
    test: { id: string; name: string; description: string | null };
    bundle: SourceBundle;
    existingSteps: Array<{ index: number; type: string; name: string }>;
  }> {
    const test = await this.prisma.testDefinition.findUnique({
      where: { id: testId },
      include: {
        project: { select: { name: true } },
        feature: {
          select: {
            name: true,
            description: true,
            module: { select: { name: true } },
            docLinks: { select: { title: true, cachedMarkdown: true } },
            docs: { select: { title: true, markdown: true } },
          },
        },
        docLinks: { select: { title: true, cachedMarkdown: true } },
        docs: { select: { title: true, markdown: true } },
      },
    });
    if (!test) throw new BadRequestException('Test not found');

    const existingSteps: Array<{ index: number; type: string; name: string }> = [];
    const stepsJson = test.steps;
    if (Array.isArray(stepsJson)) {
      for (const s of stepsJson as Array<{ index?: number; type?: string; name?: string }>) {
        if (typeof s?.index === 'number' && typeof s?.type === 'string' && typeof s?.name === 'string') {
          existingSteps.push({ index: s.index, type: s.type, name: s.name });
        }
      }
    }

    // Combine doc sources from feature + test, dedup by title. DocLinks
    // cache the markdown they last pulled from the external plugin —
    // we use that without forcing a fresh re-pull (the cache TTL is the
    // doc-link service's job, not ours).
    const docTitles = new Set<string>();
    const docs: Array<{ title: string; markdown: string }> = [];
    const pushDoc = (title?: string | null, markdown?: string | null) => {
      if (!title || !markdown) return;
      if (docTitles.has(title)) return;
      docTitles.add(title);
      docs.push({ title, markdown });
    };
    for (const d of test.docs ?? []) pushDoc(d.title, d.markdown);
    for (const d of test.feature?.docs ?? []) pushDoc(d.title, d.markdown);
    for (const dl of test.docLinks ?? []) pushDoc(dl.title, dl.cachedMarkdown);
    for (const dl of test.feature?.docLinks ?? []) pushDoc(dl.title, dl.cachedMarkdown);

    const bundle: SourceBundle = {
      freeText: extraContext,
      docs,
      scope: {
        project: test.project?.name,
        module: test.feature?.module?.name,
        feature: test.feature?.name,
      },
    };

    return {
      test: { id: test.id, name: test.name, description: test.description },
      bundle,
      existingSteps,
    };
  }

  /**
   * Parse + Zod-validate the LLM response. On validation failure we attempt
   * one round of mechanical fixes (renumber indices, default missing fields,
   * drop selector-unstable steps) before giving up. Returns warnings the UI
   * can show to the reviewer so they know what was massaged.
   */
  private parseAndAutoFix(raw: string): { proposed: G3Output; warnings: string[] } {
    const warnings: string[] = [];
    let parsed: unknown;
    try {
      parsed = parseJsonLoose(raw);
    } catch (err) {
      throw new BadRequestException(
        `Model returned invalid JSON. ${(err as Error).message}. Raw: ${raw.slice(0, 200)}…`,
      );
    }

    // Try strict parse first.
    let result = g3OutputSchema.safeParse(parsed);
    if (result.success) return { proposed: result.data, warnings };

    // Mechanical fix pass — common LLM mistakes:
    //   • Steps missing aiDescription / continueOnFail (defaults applied)
    //   • Indices non-contiguous → renumber
    //   • Selector violates stable patterns → strip the selector + warn
    if (parsed && typeof parsed === 'object' && 'steps' in (parsed as Record<string, unknown>)) {
      const rawSteps = (parsed as { steps: unknown }).steps;
      if (Array.isArray(rawSteps)) {
        const fixed: StepSchema[] = [];
        rawSteps.forEach((s, i) => {
          if (!s || typeof s !== 'object') return;
          const obj = s as Record<string, unknown>;
          const input = (obj.input ?? {}) as Record<string, unknown>;
          const sel = input.selector;
          if (sel != null && !isStableSelector(sel)) {
            warnings.push(
              `Step ${i} had unstable selector "${String(sel).slice(0, 60)}" — dropped to description-only.`,
            );
            delete input.selector;
          }
          fixed.push({
            index: i,
            type: obj.type as StepSchema['type'],
            name: typeof obj.name === 'string' ? obj.name : `Step ${i + 1}`,
            input,
            continueOnFail: obj.continueOnFail === true,
            aiDescription: typeof obj.aiDescription === 'string' ? obj.aiDescription : undefined,
          });
        });
        result = g3OutputSchema.safeParse({ steps: fixed });
        if (result.success) {
          warnings.unshift('Auto-fix applied (indices renumbered, defaults set).');
          return { proposed: result.data, warnings };
        }
      }
    }

    throw new BadRequestException(
      `Model output failed schema validation: ${result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')} — ${i.message}`)
        .join('; ')}`,
    );
  }

  private calcCost(meta: AiModelMeta, usage: { input: number | null; output: number | null }): number {
    if (usage.input == null || usage.output == null) return 0;
    return this.cost.calculate(meta.provider, meta.modelName, usage.input, usage.output);
  }

  private async recordSummary(args: {
    orgId: string;
    type: AISummaryType;
    purpose: string;
    promptVersion: string;
    modelLabel: string;
    provider: AiModelMeta['provider'];
    modelName: string;
    prompt: string;
    response: string;
    usage: { input: number | null; output: number | null };
    durationMs: number;
    costUsd?: number;
  }) {
    const cost = args.costUsd ?? this.calcCost(
      { provider: args.provider, modelName: args.modelName } as AiModelMeta,
      args.usage,
    );
    try {
      return await this.prisma.aISummary.create({
        data: {
          orgId: args.orgId,
          type: args.type,
          model: args.modelLabel,
          prompt: args.prompt,
          response: args.response,
          purpose: args.purpose,
          promptVersion: args.promptVersion,
          durationMs: args.durationMs,
          inputTokens: args.usage.input ?? undefined,
          outputTokens: args.usage.output ?? undefined,
          costUsd: cost > 0 ? new Prisma.Decimal(cost.toFixed(6)) : undefined,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to persist AISummary: ${(err as Error).message}`);
      return null;
    }
  }
}

function extractUsage(result: unknown): { input: number | null; output: number | null } {
  const meta = (result as { usage_metadata?: { input_tokens?: number; output_tokens?: number } }).usage_metadata;
  return {
    input: meta?.input_tokens ?? null,
    output: meta?.output_tokens ?? null,
  };
}

/** Strip ```json fences and parse. */
function parseJsonLoose(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}
