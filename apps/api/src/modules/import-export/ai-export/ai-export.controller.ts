import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AIExportService } from './ai-export.service';

/**
 * AI export endpoints.
 *
 *   GET /:scope/:id/ai-export        → application/zip (full bundle download)
 *   GET /:scope/:id/ai-export/prompt → text/plain     (README + conventions concatenated)
 *
 * The zip is the canonical export. The prompt endpoint is the paste-into-chat
 * shortcut — the user copies it once at the start of an AI session and then
 * follows up with "now generate three new tests for the search feature".
 */
@ApiTags('ai-export')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AIExportController {
  constructor(private readonly service: AIExportService) {}

  // ── Project ───────────────────────────────────────────────────────────

  @Get('projects/:id/ai-export')
  @ApiOperation({ summary: 'AI export bundle (zip) for a project' })
  async exportProject(@Param('id') id: string, @Res() reply: FastifyReply) {
    return this.send(reply, await this.service.buildZip('project', id));
  }

  @Get('projects/:id/ai-export/prompt')
  @ApiOperation({ summary: 'AI export prompt (text/plain) for a project — paste into LLM' })
  async promptProject(@Param('id') id: string, @Res() reply: FastifyReply) {
    return this.sendText(reply, await this.service.buildPrompt('project', id));
  }

  // ── Module ────────────────────────────────────────────────────────────

  @Get('modules/:id/ai-export')
  @ApiOperation({ summary: 'AI export bundle (zip) for a module' })
  async exportModule(@Param('id') id: string, @Res() reply: FastifyReply) {
    return this.send(reply, await this.service.buildZip('module', id));
  }

  @Get('modules/:id/ai-export/prompt')
  async promptModule(@Param('id') id: string, @Res() reply: FastifyReply) {
    return this.sendText(reply, await this.service.buildPrompt('module', id));
  }

  // ── Feature ───────────────────────────────────────────────────────────

  @Get('features/:id/ai-export')
  @ApiOperation({ summary: 'AI export bundle (zip) for a feature' })
  async exportFeature(@Param('id') id: string, @Res() reply: FastifyReply) {
    return this.send(reply, await this.service.buildZip('feature', id));
  }

  @Get('features/:id/ai-export/prompt')
  async promptFeature(@Param('id') id: string, @Res() reply: FastifyReply) {
    return this.sendText(reply, await this.service.buildPrompt('feature', id));
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private send(reply: FastifyReply, payload: { stream: NodeJS.ReadableStream; filename: string }) {
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${payload.filename}"`)
      .send(payload.stream);
  }

  private sendText(reply: FastifyReply, body: string) {
    reply.header('Content-Type', 'text/plain; charset=utf-8').send(body);
  }
}
