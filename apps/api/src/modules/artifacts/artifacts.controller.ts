import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ArtifactsService } from './artifacts.service';
import type { FastifyReply } from 'fastify';
import * as fs from 'fs';

@ApiTags('artifacts') @ApiBearerAuth() @Controller('runs/:runId/artifacts')
export class ArtifactsController {
  constructor(private readonly service: ArtifactsService) {}
  @Get() @ApiOperation({ summary: 'List artifacts for a run' }) findAll(@Param('runId') runId: string) { return this.service.findByRun(runId); }
  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Get(':id/download') async download(
    @Param('id') id: string,
    @Query('inline') inline: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const artifact = await this.service.findOne(id);
    const filePath = await this.service.getFilePath(id);
    // ?inline=1 → render in browser (img tags, lightbox). Default: attachment
    // for trace.zip / arbitrary downloads.
    const disp = inline ? `inline; filename="${artifact.filename}"` : `attachment; filename="${artifact.filename}"`;
    reply.headers({ 'Content-Type': artifact.mimeType ?? 'application/octet-stream', 'Content-Disposition': disp });
    reply.send(fs.createReadStream(filePath));
  }
}

/**
 * Convenience controller — same content, indexed only by artifact id.
 * The runId-scoped controller above is preserved for RBAC + breadcrumb use,
 * but the web UI usually only knows the artifact id (e.g. inside an <img src>)
 * and shouldn't need to look the runId up just to render a thumbnail.
 */
@ApiTags('artifacts') @ApiBearerAuth() @Controller('artifacts')
export class ArtifactsDirectController {
  constructor(private readonly service: ArtifactsService) {}

  @Get(':id') @ApiOperation({ summary: 'Get artifact metadata' })
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Get(':id/download') @ApiOperation({ summary: 'Download or inline an artifact by id' })
  async download(
    @Param('id') id: string,
    @Query('inline') inline: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const artifact = await this.service.findOne(id);
    const filePath = await this.service.getFilePath(id);
    const disp = inline ? `inline; filename="${artifact.filename}"` : `attachment; filename="${artifact.filename}"`;
    reply.headers({ 'Content-Type': artifact.mimeType ?? 'application/octet-stream', 'Content-Disposition': disp });
    reply.send(fs.createReadStream(filePath));
  }
}
