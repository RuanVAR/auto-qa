import { BadRequestException, Body, Controller, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiGenerationService } from './generation.service';

/**
 * G3 — generate steps for a specific test, streamed via Server-Sent Events.
 *
 * The UI subscribes once and renders phase pills (extracting AC → generating
 * → validating → complete). On success the final event carries the proposed
 * steps; the user picks/edits them in the preview panel before saving.
 *
 * Why SSE and not WebSocket: this is a one-shot request/response with
 * progress, not a bidirectional channel. SSE is cheaper and integrates with
 * fastify's reply.raw without ceremony.
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
  @ApiOperation({ summary: 'Stream AI-generated steps for a test (SSE)' })
  async generateSteps(
    @Param('testId') testId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { extraContext?: string },
    @Res() res: FastifyReply,
  ): Promise<void> {
    // Resolve orgId from the test row — it carries projectId → orgId.
    const test = await this.prisma.testDefinition.findUnique({
      where: { id: testId },
      include: { project: { select: { orgId: true } } },
    });
    if (!test) throw new BadRequestException('Test not found');
    const orgId = test.project.orgId;
    if (!orgId) throw new BadRequestException('Test is not associated with an organisation');

    // Open the SSE stream. We bypass fastify's serializer by going straight
    // to reply.raw — keep-alive headers + flushed status line.
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

    // Heartbeat every 15s so reverse proxies don't time the connection out.
    const heartbeat = setInterval(() => raw.write(`: ping\n\n`), 15_000);

    try {
      for await (const evt of this.service.generateStepsForTest({
        testId,
        orgId,
        userId: user.sub,
        extraContext: body.extraContext,
      })) {
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
