import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AISummaryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiCredentialResolver } from './credential-resolver.service';
import { AiCostCalculator } from './cost-calculator.service';
import { AiModelMeta } from './providers/provider.factory';

/**
 * Legacy AI entry points (failure-explain, run-summarise, generate-test).
 *
 * Phase 0 wired these through AiCredentialResolver so every call now uses
 * the per-org BYOK credential and records cost / latency / token counts on
 * AISummary. Generation surfaces (G1/G2/G3) build on the same plumbing in
 * later phases.
 *
 * Calls require the caller to be inside an org — runs / tests / projects
 * all carry an orgId via their parent rows; we look it up before invoking
 * the resolver. If a run's project has no org link (legacy data) we throw
 * a clear error rather than silently bypassing the credential scope.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly credentials: AiCredentialResolver,
    private readonly cost: AiCostCalculator,
  ) {
    // Keep ConfigService injected so the env-var fallback path inside the
    // resolver still works (it reads AI_ALLOW_PLATFORM_DEFAULT).
    void this.config;
  }

  async explainFailure(runId: string) {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: {
        steps: { orderBy: { index: 'asc' } },
        testDefinition: { select: { name: true } },
        environment: { select: { name: true, type: true, baseUrl: true } },
        project: { select: { orgId: true } },
      },
    });
    if (!run) throw new BadRequestException('Run not found');
    const orgId = run.project.orgId;
    if (!orgId) throw new BadRequestException('Run is not associated with an organisation');

    const failed = run.steps.filter((s) => s.status === 'FAILED' || s.status === 'ERROR');
    const prompt =
      `You are a QA engineer analysing a failed automated test run.\n` +
      `Test: ${run.testDefinition.name}\n` +
      `Environment: ${run.environment?.name ?? 'N/A'} (${run.environment?.baseUrl ?? 'N/A'})\n` +
      `Status: ${run.status}\n` +
      `Failed steps: ${failed.map((s, i) => `${i + 1}. [${s.type}] ${s.name} — ${s.errorMessage ?? 'no message'}`).join('\n')}\n` +
      `All steps: ${run.steps.map((s) => `[${s.status}] ${s.name}`).join(', ')}\n\n` +
      `Provide: 1) Root cause (1-2 sentences) 2) Failure category (UI/API/Auth/Network/Selector/Timeout/Data/Other) ` +
      `3) Suggested fix (2-3 bullets) 4) Confidence (High/Medium/Low)`;

    return this.invokeAndRecord({
      orgId,
      runId,
      type: AISummaryType.FAILURE_EXPLANATION,
      purpose: 'failure_explain',
      prompt,
    });
  }

  async summariseRun(runId: string) {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: {
        steps: { orderBy: { index: 'asc' } },
        testDefinition: { select: { name: true } },
        environment: { select: { name: true, type: true } },
        project: { select: { orgId: true } },
      },
    });
    if (!run) throw new BadRequestException('Run not found');
    const orgId = run.project.orgId;
    if (!orgId) throw new BadRequestException('Run is not associated with an organisation');

    const passed = run.steps.filter((s) => s.status === 'PASSED').length;
    const prompt =
      `Summarise this test run in plain English.\n` +
      `Test: ${run.testDefinition.name} | Status: ${run.status} | Duration: ${run.duration}ms | ` +
      `Steps: ${passed}/${run.steps.length} passed\n` +
      `Steps: ${run.steps.map((s) => `[${s.status}] ${s.name}`).join(', ')}\n\n` +
      `Write 3-5 sentences. Mention what passed, what failed, and overall health.`;

    return this.invokeAndRecord({
      orgId,
      runId,
      type: AISummaryType.RUN_SUMMARY,
      purpose: 'run_summary',
      prompt,
    });
  }

  async generateTest(prompt: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw new BadRequestException('Project not found');
    if (!project.orgId) throw new BadRequestException('Project is not associated with an organisation');

    const system =
      `You are a QA automation engineer. Generate a JSON test definition. Return ONLY valid JSON:\n` +
      `{"name":"...","description":"...","tags":["..."],"steps":[{"index":0,"name":"...","type":` +
      `"NAVIGATE|CLICK|FILL|SELECT|ASSERT_TEXT|ASSERT_VISIBLE|ASSERT_URL|WAIT|SCREENSHOT|API_REQUEST",` +
      `"input":{}}],"config":{"browser":"chromium","headless":true,"timeout":30000,"retries":1}}\n` +
      // This previously read "Use CSS selectors", which directly contradicted
      // isStableSelector() in prompts/base/output-schemas.ts, the same rule in
      // packages/shared, and the DSL verb table — all of which REJECT raw CSS as
      // brittle. The endpoint was producing tests the platform's own validator
      // would refuse.
      `Selectors must be stable: [data-testid="…"], [role="…"], getByText("…"), ` +
      `#stable-id, or input[name|placeholder|aria-label="…"]. ` +
      `Never emit a raw CSS path such as div > div:nth-child(3) — it breaks on ` +
      `any layout change. Be specific and realistic.`;

    const composedPrompt = `[SYSTEM]\n${system}\n\n[USER]\n${prompt}`;
    const { response } = await this.invokeAndRecord({
      orgId: project.orgId,
      runId: null,
      type: AISummaryType.TEST_GENERATION,
      purpose: 'generate_test',
      prompt: composedPrompt,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    });

    const raw = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    try {
      return JSON.parse(raw);
    } catch {
      throw new BadRequestException('AI returned invalid JSON. Try rephrasing your prompt.');
    }
  }

  /**
   * Resolve the org's model, invoke the prompt, capture usage/latency/cost,
   * persist an AISummary row, and hand the response back. Single chokepoint
   * so every legacy entry point gets identical observability.
   */
  private async invokeAndRecord(args: {
    orgId: string;
    runId: string | null;
    type: AISummaryType;
    purpose: string;
    prompt: string;
    messages?: Array<{ role: 'system' | 'user'; content: string }>;
  }): Promise<{ response: string; aiSummaryId: string }> {
    const meta: AiModelMeta = await this.credentials.resolveForOrg(args.orgId);
    const t0 = Date.now();
    const result = args.messages
      ? await meta.model.invoke(args.messages)
      : await meta.model.invoke(args.prompt);
    const durationMs = Date.now() - t0;

    const usage = (result as unknown as { usage_metadata?: { input_tokens?: number; output_tokens?: number } })
      .usage_metadata;
    const inputTokens = usage?.input_tokens ?? null;
    const outputTokens = usage?.output_tokens ?? null;
    const costUsd =
      inputTokens != null && outputTokens != null
        ? this.cost.calculate(meta.provider, meta.modelName, inputTokens, outputTokens)
        : null;

    const response = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);

    const summary = await this.prisma.aISummary
      .create({
        data: {
          orgId: args.orgId,
          runId: args.runId,
          type: args.type,
          model: meta.label,
          prompt: args.prompt,
          response,
          purpose: args.purpose,
          durationMs,
          inputTokens: inputTokens ?? undefined,
          outputTokens: outputTokens ?? undefined,
          costUsd: costUsd != null ? new Prisma.Decimal(costUsd.toFixed(6)) : undefined,
        },
      })
      .catch((err) => {
        // Don't lose the response just because the bookkeeping write failed.
        this.logger.warn(`Failed to persist AISummary: ${(err as Error).message}`);
        return null;
      });

    return { response, aiSummaryId: summary?.id ?? '' };
  }
}
