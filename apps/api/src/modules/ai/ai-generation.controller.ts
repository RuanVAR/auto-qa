import { BadRequestException, Body, Controller, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiGenerationService } from './generation.service';
import { g2OutputSchema, TestCaseSchema } from './prompts/base/output-schemas';

/**
 * AI generation endpoints — SSE-streamed.
 *
 * The UI subscribes once per request and renders phase pills as events
 * arrive (extracting AC → generating → validating → complete). On
 * success the final event carries the proposed payload; the user picks
 * what to keep in the preview panel before anything is persisted.
 *
 * Why SSE and not WebSocket: each call is a one-shot request/response
 * with progress, not a bidirectional channel. SSE is cheaper and
 * integrates with fastify's reply.raw without ceremony.
 */
@ApiTags('ai-generation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AiGenerationController {
  constructor(
    private readonly service: AiGenerationService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('tests/:testId/ai/steps')
  @ApiOperation({ summary: 'Stream AI-generated steps for a test (SSE, G3)' })
  async generateSteps(
    @Param('testId') testId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { extraContext?: string },
    @Res() res: FastifyReply,
  ): Promise<void> {
    const test = await this.prisma.testDefinition.findUnique({
      where: { id: testId },
      include: { project: { select: { orgId: true } } },
    });
    if (!test) throw new BadRequestException('Test not found');
    const orgId = test.project.orgId;
    if (!orgId) throw new BadRequestException('Test is not associated with an organisation');

    return this.streamPhases(
      res,
      this.service.generateStepsForTest({
        testId,
        orgId,
        userId: user.sub,
        extraContext: body.extraContext,
      }),
    );
  }

  @Post('features/:featureId/ai/tests')
  @ApiOperation({ summary: 'Stream AI-generated test cases for a feature (SSE, G2)' })
  async generateTests(
    @Param('featureId') featureId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { extraContext?: string; testCountTarget?: number },
    @Res() res: FastifyReply,
  ): Promise<void> {
    // Walk feature → module → project → orgId. Same resolution the
    // service does, just earlier so we can fail fast before opening
    // the SSE stream.
    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId },
      include: { module: { select: { project: { select: { orgId: true } } } } },
    });
    if (!feature) throw new BadRequestException('Feature not found');
    const orgId = feature.module?.project?.orgId;
    if (!orgId) throw new BadRequestException('Feature is not associated with an organisation');

    return this.streamPhases(
      res,
      this.service.generateTestsForFeature({
        featureId,
        orgId,
        userId: user.sub,
        extraContext: body.extraContext,
        testCountTarget: body.testCountTarget,
      }),
    );
  }

  @Post('features/:featureId/ai/tests/apply')
  @ApiOperation({
    summary: 'Persist user-approved G2 test cases as TestDefinitions on a feature',
  })
  async applyTests(
    @Param('featureId') featureId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { testCases: TestCaseSchema[]; aiSummaryId?: string; sourcePrompt?: string; ac?: string[] },
  ): Promise<{ created: Array<{ id: string; name: string }>; skipped: Array<{ name: string; reason: string }> }> {
    // Validate the payload against the Zod schema — accept only well-formed
    // test cases. Anything that fails validation is reported back as a
    // skip with a reason rather than aborting the whole batch.
    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId },
      include: { module: { select: { projectId: true, project: { select: { orgId: true } } } } },
    });
    if (!feature) throw new BadRequestException('Feature not found');
    if (!feature.module?.project?.orgId) {
      throw new BadRequestException('Feature is not associated with an organisation');
    }
    const projectId = feature.module.projectId;

    const skipped: Array<{ name: string; reason: string }> = [];
    const created: Array<{ id: string; name: string }> = [];

    const parsed = g2OutputSchema.safeParse({ testCases: body.testCases });
    if (!parsed.success) {
      throw new BadRequestException(
        'Invalid test-case payload: ' +
          parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.')} — ${i.message}`)
            .join('; '),
      );
    }

    // We don't transaction the whole batch — partial success is more
    // helpful to the user than "one bad row killed everything". Each
    // create is independent.
    for (const tc of parsed.data.testCases) {
      try {
        const row = await this.prisma.testDefinition.create({
          data: {
            projectId,
            featureId,
            name: tc.name,
            description: tc.description ?? null,
            type: 'UI',
            tags: ['ai-generated', 'unreviewed', ...(tc.tags ?? [])],
            steps: tc.steps as unknown as Prisma.InputJsonValue,
            isAiDraft: true,
            aiGenerationMetadata: {
              promptVersion: 'tests-from-feature@1.0',
              aiSummaryId: body.aiSummaryId ?? null,
              sourcePrompt: body.sourcePrompt ?? null,
              acceptanceCriteria: tc.mappedAcceptanceCriteria ?? [],
              extractedAc: body.ac ?? [],
              createdByUserId: user.sub,
            } as Prisma.InputJsonValue,
          },
        });
        created.push({ id: row.id, name: row.name });
      } catch (err) {
        skipped.push({ name: tc.name, reason: (err as Error).message ?? 'create failed' });
      }
    }

    return { created, skipped };
  }

  /**
   * Shared SSE plumbing: writes the response header, pipes phase events
   * to `event:` frames, heartbeats every 15s to defeat reverse-proxy
   * idle timeouts, and tidies up on error or completion. One function
   * for both G2 and G3 so the frame format stays identical.
   */
  private async streamPhases(
    res: FastifyReply,
    generator: AsyncGenerator<{ phase: string; message?: string; data?: Record<string, unknown> }, void, void>,
  ): Promise<void> {
    const raw = res.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, payload: unknown) => {
      raw.write(`event: ${event}\n`);
      raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const heartbeat = setInterval(() => raw.write(`: ping\n\n`), 15_000);

    try {
      for await (const evt of generator) {
        send(evt.phase, { message: evt.message, data: evt.data });
      }
    } catch (err) {
      send('error', { message: (err as Error).message ?? 'Generation failed' });
    } finally {
      clearInterval(heartbeat);
      raw.end();
    }
  }
}
