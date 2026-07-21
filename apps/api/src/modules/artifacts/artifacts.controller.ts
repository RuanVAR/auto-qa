import { Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ArtifactsService } from './artifacts.service';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { EnvAccessService } from '../../common/access/env-access.service';
import { accessCtx } from '../../common/access/access-context';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Streams an artifact through the configured storage backend (local / S3 /
 * GCS / Azure) with HTTP Range support so videos can seek. Shared by both
 * the runId-scoped and id-only controllers below.
 */
async function sendArtifact(
  service: ArtifactsService,
  id: string,
  inline: string | undefined,
  req: FastifyRequest,
  res: FastifyReply,
) {
  const d = await service.openArtifact(id);
  const disp = inline
    ? `inline; filename="${encodeURIComponent(d.filename)}"`
    : `attachment; filename="${encodeURIComponent(d.filename)}"`;
  res.header('Content-Type', d.mimeType);
  res.header('Content-Disposition', disp);
  res.header('Accept-Ranges', 'bytes');
  // Allow cross-origin <img>/<video> reads from the web app (see uploads).
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');

  const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (match) {
      const start = parseInt(match[1], 10);
      let end = match[2] ? parseInt(match[2], 10) : d.size - 1;
      if (Number.isNaN(end) || end >= d.size) end = d.size - 1;
      if (start >= d.size || start > end) {
        res.header('Content-Range', `bytes */${d.size}`);
        res.code(416).send();
        return;
      }
      const stream = await d.streamRange(start, end);
      res.header('Content-Length', String(end - start + 1));
      res.header('Content-Range', `bytes ${start}-${end}/${d.size}`);
      res.code(206).send(stream);
      return;
    }
  }

  const stream = await d.streamFull();
  res.header('Content-Length', String(d.size));
  res.send(stream);
}

@ApiTags('artifacts') @ApiBearerAuth() @Controller('runs/:runId/artifacts')
export class ArtifactsController {
  constructor(private readonly service: ArtifactsService, private readonly envAccess: EnvAccessService) {}
  private async assertAccess(id: string, user: JwtPayload) {
    const scope = await this.service.getAccessScope(id);
    if (scope.environmentId) {
      await this.envAccess.assertEnvAccess(user.sub, scope.projectId, scope.environmentId, accessCtx(user));
    } else {
      await this.envAccess.assertProjectAccess(user.sub, scope.projectId, accessCtx(user));
    }
  }
  @Get() @ApiOperation({ summary: 'List artifacts for a run' }) findAll(@Param('runId') runId: string) { return this.service.findByRun(runId); }
  @Get(':id') async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) { await this.assertAccess(id, user); return this.service.findOne(id); }
  @Post(':id/trace-viewer-token') @ApiOperation({ summary: 'Issue a five-minute token for the embedded Playwright trace viewer' })
  async traceViewerToken(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.assertAccess(id, user);
    return { token: await this.service.issueTraceViewerToken(id) };
  }
  @Get(':id/download') async download(
    @Param('id') id: string,
    @Query('inline') inline: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @CurrentUser() user: JwtPayload,
  ) {
    // ?inline=1 → render in browser (img tags, lightbox). Default: attachment
    // for trace.zip / arbitrary downloads.
    await this.assertAccess(id, user);
    await sendArtifact(this.service, id, inline, req, reply);
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
  constructor(private readonly service: ArtifactsService, private readonly envAccess: EnvAccessService) {}
  private async assertAccess(id: string, user: JwtPayload) {
    const scope = await this.service.getAccessScope(id);
    if (scope.environmentId) {
      await this.envAccess.assertEnvAccess(user.sub, scope.projectId, scope.environmentId, accessCtx(user));
    } else {
      await this.envAccess.assertProjectAccess(user.sub, scope.projectId, accessCtx(user));
    }
  }

  @Get(':id') @ApiOperation({ summary: 'Get artifact metadata' })
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) { await this.assertAccess(id, user); return this.service.findOne(id); }

  @Post(':id/trace-viewer-token') @ApiOperation({ summary: 'Issue a five-minute token for the embedded Playwright trace viewer' })
  async traceViewerToken(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.assertAccess(id, user);
    return { token: await this.service.issueTraceViewerToken(id) };
  }

  @Get(':id/download') @ApiOperation({ summary: 'Download or inline an artifact by id' })
  async download(
    @Param('id') id: string,
    @Query('inline') inline: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertAccess(id, user);
    await sendArtifact(this.service, id, inline, req, reply);
  }

  /** The viewer runs in a separate origin and fetches this short-lived URL. */
  @Public()
  @Get(':id/trace') @ApiOperation({ summary: 'Stream a trace using a short-lived trace-viewer token' })
  async trace(
    @Param('id') id: string,
    @Query('token') token: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const d = await this.service.openTraceWithToken(id, token);
    reply.header('Content-Type', d.mimeType);
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(d.filename)}"`);
    reply.header('Access-Control-Allow-Origin', 'https://trace.playwright.dev');
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    reply.header('Cache-Control', 'private, no-store');
    reply.send(await d.streamFull());
  }
}
