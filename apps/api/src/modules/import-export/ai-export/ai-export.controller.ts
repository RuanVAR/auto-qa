import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AIExportService } from './ai-export.service';

/**
 * AI export endpoints.
 *
 *   GET /:scope/:id/ai-export          → application/zip      (full bundle download)
 *   GET /:scope/:id/ai-export/prompt   → text/plain           (paste-into-LLM blob)
 *   GET /:scope/:id/ai-export/markdown → text/markdown (.md)  (file upload — best for Gemini)
 *
 * The zip is the canonical export. The prompt endpoint is the paste-into-chat
 * shortcut. The markdown endpoint serves the same content as `prompt` but as
 * an `.md` file attachment — needed for LLM web UIs that reject `.zip` uploads
 * (Gemini AI Studio in particular only accepts text / md / pdf, never zips).
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

  @Get('projects/:id/ai-export/markdown')
  @ApiOperation({ summary: 'AI export as a single .md file (best for Gemini AI Studio uploads)' })
  async markdownProject(@Param('id') id: string, @Res() reply: FastifyReply) {
    return this.sendMarkdown(reply, await this.service.buildPrompt('project', id), 'project', id);
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

  @Get('modules/:id/ai-export/markdown')
  @ApiOperation({ summary: 'AI export as a single .md file (best for Gemini AI Studio uploads)' })
  async markdownModule(@Param('id') id: string, @Res() reply: FastifyReply) {
    return this.sendMarkdown(reply, await this.service.buildPrompt('module', id), 'module', id);
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

  @Get('features/:id/ai-export/markdown')
  @ApiOperation({ summary: 'AI export as a single .md file (best for Gemini AI Studio uploads)' })
  async markdownFeature(@Param('id') id: string, @Res() reply: FastifyReply) {
    return this.sendMarkdown(reply, await this.service.buildPrompt('feature', id), 'feature', id);
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

  /**
   * Serve the same `buildPrompt` content but as a downloadable `.md` file.
   * Filename pattern matches the zip path: `<scope>-<id>-ai-export-<date>.md`
   * so users can recognise pairs in their downloads folder.
   */
  private sendMarkdown(reply: FastifyReply, body: string, scope: string, id: string) {
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${scope}-${id.slice(0, 8)}-ai-export-${date}.md`;
    reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(body);
  }
}
