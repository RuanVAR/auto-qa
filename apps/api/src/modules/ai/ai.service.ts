import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AISummaryType } from '@prisma/client';
import { createAiModel } from './providers/provider.factory';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async explainFailure(runId: string) {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: {
        steps: { orderBy: { index: 'asc' } },
        testDefinition: { select: { name: true } },
        environment: { select: { name: true, type: true, baseUrl: true } },
      },
    });
    if (!run) throw new Error('Run not found');

    const failed = run.steps.filter(s => s.status === 'FAILED' || s.status === 'ERROR');
    const prompt =
      `You are a QA engineer analysing a failed automated test run.\n` +
      `Test: ${run.testDefinition.name}\n` +
      `Environment: ${run.environment?.name ?? 'N/A'} (${run.environment?.baseUrl ?? 'N/A'})\n` +
      `Status: ${run.status}\n` +
      `Failed steps: ${failed.map((s, i) => `${i + 1}. [${s.type}] ${s.name} — ${s.errorMessage ?? 'no message'}`).join('\n')}\n` +
      `All steps: ${run.steps.map(s => `[${s.status}] ${s.name}`).join(', ')}\n\n` +
      `Provide: 1) Root cause (1-2 sentences) 2) Failure category (UI/API/Auth/Network/Selector/Timeout/Data/Other) ` +
      `3) Suggested fix (2-3 bullets) 4) Confidence (High/Medium/Low)`;

    const { model, label } = await createAiModel(this.config);
    const result = await model.invoke(prompt);
    const response = result.content as string;
    await this.saveAiSummary(runId, AISummaryType.FAILURE_EXPLANATION, prompt, response, label);
    return response;
  }

  async summariseRun(runId: string) {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: {
        steps: { orderBy: { index: 'asc' } },
        testDefinition: { select: { name: true } },
        environment: { select: { name: true, type: true } },
      },
    });
    if (!run) throw new Error('Run not found');

    const passed = run.steps.filter(s => s.status === 'PASSED').length;
    const prompt =
      `Summarise this test run in plain English.\n` +
      `Test: ${run.testDefinition.name} | Status: ${run.status} | Duration: ${run.duration}ms | ` +
      `Steps: ${passed}/${run.steps.length} passed\n` +
      `Steps: ${run.steps.map(s => `[${s.status}] ${s.name}`).join(', ')}\n\n` +
      `Write 3-5 sentences. Mention what passed, what failed, and overall health.`;

    const { model, label } = await createAiModel(this.config);
    const result = await model.invoke(prompt);
    const response = result.content as string;
    await this.saveAiSummary(runId, AISummaryType.RUN_SUMMARY, prompt, response, label);
    return response;
  }

  async generateTest(prompt: string, projectId: string) {
    const system =
      `You are a QA automation engineer. Generate a JSON test definition. Return ONLY valid JSON:\n` +
      `{"name":"...","description":"...","tags":["..."],"steps":[{"index":0,"name":"...","type":` +
      `"NAVIGATE|CLICK|FILL|SELECT|ASSERT_TEXT|ASSERT_VISIBLE|ASSERT_URL|WAIT|SCREENSHOT|API_REQUEST",` +
      `"input":{}}],"config":{"browser":"chromium","headless":true,"timeout":30000,"retries":1}}\n` +
      `Use CSS selectors. Be specific and realistic.`;

    const { model, label } = await createAiModel(this.config);
    const result = await model.invoke([
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ]);
    const raw = (result.content as string)
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('AI returned invalid JSON. Try rephrasing your prompt.');
    }
  }

  private async saveAiSummary(
    runId: string,
    type: AISummaryType,
    prompt: string,
    response: string,
    modelLabel: string,
  ) {
    try {
      await this.prisma.aISummary.create({
        data: { runId, type, model: modelLabel, prompt, response },
      });
    } catch (err) {
      this.logger.warn('Failed to persist AI summary: ' + err);
    }
  }
}
