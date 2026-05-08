import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Manual ("local") doc CRUD.
 *
 * Companion to DocsController (which manages remote/linked docs from plugin
 * installs). Same multi-scope shape: a doc can attach to a project / module /
 * feature / test. Markdown is stored verbatim; rendering is the frontend's job.
 *
 * Authorisation: the JWT guard ensures the caller is logged in. Project/scope
 * RBAC layers on top via the existing project-membership rails (TODO when
 * project RBAC fully lands — for now any authenticated user with access to
 * the entity can author).
 */
@ApiTags('docs-local')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class DocsLocalController {
  constructor(private readonly prisma: PrismaService) {}

  // ── Lookups ────────────────────────────────────────────────────────────

  @Get('projects/:projectId/docs')
  listForProject(@Param('projectId') projectId: string) {
    return this.prisma.doc.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: this.summarySelect(),
    });
  }

  @Get('modules/:moduleId/docs')
  listForModule(@Param('moduleId') moduleId: string) {
    return this.prisma.doc.findMany({
      where: { moduleId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: this.summarySelect(),
    });
  }

  @Get('features/:featureId/docs')
  listForFeature(@Param('featureId') featureId: string) {
    return this.prisma.doc.findMany({
      where: { featureId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: this.summarySelect(),
    });
  }

  @Get('tests/:testId/docs')
  listForTest(@Param('testId') testId: string) {
    return this.prisma.doc.findMany({
      where: { testDefinitionId: testId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: this.summarySelect(),
    });
  }

  @Get('docs/:id')
  async getOne(@Param('id') id: string) {
    const doc = await this.prisma.doc.findFirst({
      where: { id, deletedAt: null },
      include: {
        author: { select: { id: true, name: true, email: true } },
        editor: { select: { id: true, name: true, email: true } },
      },
    });
    if (!doc) throw new NotFoundException('Doc not found');
    return doc;
  }

  // ── Create + edit ──────────────────────────────────────────────────────

  @Post('projects/:projectId/docs')
  @ApiOperation({ summary: 'Create a manual doc scoped to a project' })
  createForProject(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateDocBody,
  ) {
    return this.createScoped({ projectId }, user, body);
  }

  @Post('modules/:moduleId/docs')
  createForModule(
    @Param('moduleId') moduleId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateDocBody,
  ) {
    return this.createScoped({ moduleId }, user, body);
  }

  @Post('features/:featureId/docs')
  createForFeature(
    @Param('featureId') featureId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateDocBody,
  ) {
    return this.createScoped({ featureId }, user, body);
  }

  @Post('tests/:testId/docs')
  createForTest(
    @Param('testId') testId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateDocBody,
  ) {
    return this.createScoped({ testDefinitionId: testId }, user, body);
  }

  @Patch('docs/:id')
  @ApiOperation({ summary: 'Edit a manual doc (markdown + title + summary)' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: UpdateDocBody,
  ) {
    const doc = await this.prisma.doc.findFirst({ where: { id, deletedAt: null } });
    if (!doc) throw new NotFoundException('Doc not found');
    return this.prisma.doc.update({
      where: { id },
      data: {
        title: body.title ?? doc.title,
        markdown: body.markdown ?? doc.markdown,
        summary: body.summary ?? doc.summary,
        editorId: user.sub,
      },
    });
  }

  @Delete('docs/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.prisma.doc.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async createScoped(
    scope: { projectId?: string; moduleId?: string; featureId?: string; testDefinitionId?: string },
    user: JwtPayload,
    body: CreateDocBody,
  ) {
    const orgId = await this.resolveOrgId(scope);
    return this.prisma.doc.create({
      data: {
        orgId,
        ...scope,
        title: body.title,
        markdown: body.markdown ?? '',
        summary: body.summary,
        authorId: user.sub,
      },
    });
  }

  /**
   * Resolve orgId from whichever scope key is supplied. Prefer the most
   * specific scope's parent project to find org — features → module → project,
   * tests → project, etc.
   */
  private async resolveOrgId(scope: {
    projectId?: string;
    moduleId?: string;
    featureId?: string;
    testDefinitionId?: string;
  }): Promise<string> {
    if (scope.projectId) {
      const p = await this.prisma.project.findUnique({ where: { id: scope.projectId }, select: { orgId: true } });
      if (!p?.orgId) throw new NotFoundException('Project has no org — required for doc creation');
      return p.orgId;
    }
    if (scope.moduleId) {
      const m = await this.prisma.module.findUnique({
        where: { id: scope.moduleId },
        select: { project: { select: { orgId: true } } },
      });
      if (!m?.project?.orgId) throw new NotFoundException('Module project has no org');
      return m.project.orgId;
    }
    if (scope.featureId) {
      const f = await this.prisma.feature.findUnique({
        where: { id: scope.featureId },
        select: { module: { select: { project: { select: { orgId: true } } } } },
      });
      if (!f?.module?.project?.orgId) throw new NotFoundException('Feature project has no org');
      return f.module.project.orgId;
    }
    if (scope.testDefinitionId) {
      const t = await this.prisma.testDefinition.findUnique({
        where: { id: scope.testDefinitionId },
        select: { project: { select: { orgId: true } } },
      });
      if (!t?.project?.orgId) throw new NotFoundException('Test project has no org');
      return t.project.orgId;
    }
    throw new NotFoundException('No scope id provided');
  }

  private summarySelect() {
    return {
      id: true,
      title: true,
      summary: true,
      updatedAt: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
      editor: { select: { id: true, name: true } },
    } as const;
  }
}

type CreateDocBody = { title: string; markdown?: string; summary?: string };
type UpdateDocBody = { title?: string; markdown?: string; summary?: string };
