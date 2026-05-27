import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { PluginService } from './plugin.service';

/**
 * External documentation links (Phase 4).
 *
 * A DocLink can attach to a feature, module, or project (or all three at
 * once via multi-scope). The cached markdown is fetched lazily — the link
 * row holds metadata + a 24h cache window. `refresh` busts the cache via
 * the plugin's `fetchDoc` capability.
 */
@ApiTags('plugin-docs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class DocsController {
  private static readonly DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly plugins: PluginService,
  ) {}

  // ── Lookups ────────────────────────────────────────────────────────────

  @Get('features/:featureId/doc-links')
  listForFeature(@Param('featureId') featureId: string) {
    return this.prisma.docLink.findMany({
      where: { featureId, deletedAt: null },
      include: { install: { select: { id: true, pluginId: true, displayLabel: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('modules/:moduleId/doc-links')
  listForModule(@Param('moduleId') moduleId: string) {
    return this.prisma.docLink.findMany({
      where: { moduleId, deletedAt: null },
      include: { install: { select: { id: true, pluginId: true, displayLabel: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('projects/:projectId/doc-links')
  listForProject(@Param('projectId') projectId: string) {
    return this.prisma.docLink.findMany({
      where: { projectId, deletedAt: null },
      include: { install: { select: { id: true, pluginId: true, displayLabel: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('tests/:testId/doc-links')
  listForTest(@Param('testId') testId: string) {
    return this.prisma.docLink.findMany({
      where: { testDefinitionId: testId, deletedAt: null },
      include: { install: { select: { id: true, pluginId: true, displayLabel: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Search remote docs ────────────────────────────────────────────────

  @Post('orgs/:orgId/plugin-installs/:installId/docs/search')
  @SkipThrottle({ global: true, auth: true })
  @ApiOperation({ summary: 'Search the install for available external docs (lookup before linking)' })
  search(
    @Param('installId') installId: string,
    @Body() body: { query?: string; limit?: number; cursor?: string },
  ) {
    return this.plugins.dispatch('listDocs', installId, body, {});
  }

  // ── Link / unlink ─────────────────────────────────────────────────────

  /**
   * Page tree for a doc — used by the "link" UI to let the user pick a
   * specific page rather than the whole doc when linking. Returns the flat
   * pageListing (id + name + parent_page_id) ready for tree rendering.
   */
  @Get('orgs/:orgId/plugin-installs/:installId/docs/:docId/pages')
  pageListing(@Param('installId') installId: string, @Param('docId') docId: string) {
    return this.plugins.dispatch(
      'listEntities' as never,
      installId,
      { kind: 'doc-pages', parent: { docId } },
      {},
    );
  }

  @Post('features/:featureId/doc-links')
  @ApiOperation({ summary: 'Link a remote doc (or doc page) to a feature' })
  linkToFeature(@Param('featureId') featureId: string, @Body() body: LinkDocBody) {
    return this.linkScoped({ featureId }, body);
  }

  @Post('modules/:moduleId/doc-links')
  @ApiOperation({ summary: 'Link a remote doc (or doc page) to a module' })
  linkToModule(@Param('moduleId') moduleId: string, @Body() body: LinkDocBody) {
    return this.linkScoped({ moduleId }, body);
  }

  @Post('projects/:projectId/doc-links')
  @ApiOperation({ summary: 'Link a remote doc (or doc page) to a project' })
  linkToProject(@Param('projectId') projectId: string, @Body() body: LinkDocBody) {
    return this.linkScoped({ projectId }, body);
  }

  @Post('tests/:testId/doc-links')
  @ApiOperation({ summary: 'Link a remote doc (or doc page) to a test' })
  linkToTest(@Param('testId') testId: string, @Body() body: LinkDocBody) {
    return this.linkScoped({ testDefinitionId: testId }, body);
  }

  private async linkScoped(
    scope: { projectId?: string; moduleId?: string; featureId?: string; testDefinitionId?: string },
    body: LinkDocBody,
  ) {
    const install = await this.prisma.orgPluginInstall.findUnique({ where: { id: body.installId } });
    if (!install || install.deletedAt) throw new NotFoundException('Install not found');

    return this.prisma.docLink.create({
      data: {
        orgId: install.orgId,
        installId: install.id,
        ...scope,
        externalId: body.externalId,
        externalUrl: body.externalUrl,
        title: body.title,
        summary: body.summary,
        pageId: body.pageId,
      },
    });
  }

  @Delete('doc-links/:id')
  @HttpCode(204)
  async unlink(@Param('id') id: string) {
    await this.prisma.docLink.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Refresh cached markdown ───────────────────────────────────────────

  @Post('doc-links/:id/refresh')
  @ApiOperation({ summary: 'Re-fetch cached markdown via fetchDoc capability (page-aware)' })
  async refresh(@Param('id') id: string, @CurrentUser() _user: JwtPayload) {
    const link = await this.prisma.docLink.findUnique({ where: { id } });
    if (!link || link.deletedAt) throw new NotFoundException('DocLink not found');
    const result = await this.plugins.dispatch<{
      title: string;
      markdown: string;
      updatedAt: string;
    }>('fetchDoc', link.installId, { externalId: link.externalId, pageId: link.pageId ?? undefined }, {});

    const now = new Date();
    return this.prisma.docLink.update({
      where: { id },
      data: {
        title: result.title || link.title,
        cachedMarkdown: result.markdown,
        cachedAt: now,
        cacheExpiresAt: new Date(now.getTime() + DocsController.DEFAULT_TTL_MS),
      } as Prisma.DocLinkUpdateInput,
    });
  }

  /**
   * Get a doc-link's cached markdown, refreshing when the cache is empty or
   * expired. Used by the feature-header pill and the AI prompt builder.
   */
  @Get('doc-links/:id/content')
  async getContent(@Param('id') id: string) {
    const link = await this.prisma.docLink.findUnique({ where: { id } });
    if (!link || link.deletedAt) throw new NotFoundException('DocLink not found');
    const expired = !link.cacheExpiresAt || link.cacheExpiresAt < new Date();
    if (link.cachedMarkdown && !expired) {
      return {
        id: link.id,
        title: link.title,
        externalUrl: link.externalUrl,
        markdown: link.cachedMarkdown,
        cachedAt: link.cachedAt,
        cacheExpiresAt: link.cacheExpiresAt,
        cached: true,
      };
    }
    const result = await this.plugins.dispatch<{
      title: string;
      markdown: string;
      updatedAt: string;
    }>('fetchDoc', link.installId, { externalId: link.externalId, pageId: link.pageId ?? undefined }, {});
    const now = new Date();
    const updated = await this.prisma.docLink.update({
      where: { id },
      data: {
        title: result.title || link.title,
        cachedMarkdown: result.markdown,
        cachedAt: now,
        cacheExpiresAt: new Date(now.getTime() + DocsController.DEFAULT_TTL_MS),
      },
    });
    return {
      id: updated.id,
      title: updated.title,
      externalUrl: updated.externalUrl,
      markdown: updated.cachedMarkdown,
      cachedAt: updated.cachedAt,
      cacheExpiresAt: updated.cacheExpiresAt,
      cached: false,
    };
  }
}

type LinkDocBody = {
  installId: string;
  externalId: string;
  externalUrl: string;
  title: string;
  summary?: string;
  /** When set, the link targets a specific page within the doc. Null/missing = whole doc. */
  pageId?: string;
};
