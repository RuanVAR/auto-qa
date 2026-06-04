import { Controller, Get, Post, Put, Delete, Param, Body, Query, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FeaturesService } from './features.service';
import { StatsService } from '../stats/stats.service';
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';
import { ReorderFeaturesDto } from './dto/reorder-features.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';

@ApiTags('features') @ApiBearerAuth()
@Controller('modules/:moduleId/features')
export class FeaturesController {
  constructor(
    private readonly service: FeaturesService,
    private readonly statsService: StatsService,
  ) {}

  @Get() @ApiOperation({ summary: 'List features for a module' })
  findAll(@Param('moduleId') moduleId: string) {
    return this.service.findByModule(moduleId);
  }

  @Get('stats') @ApiOperation({ summary: 'Get stats for all features in a module' })
  getStats(@Param('moduleId') moduleId: string, @Query('envId') envId?: string) {
    return this.statsService.computeFeatureStatsForModule(moduleId, envId ?? null);
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Get(':id/draft-status') draftStatus(@Param('id') id: string) {
    return this.service.getDraftStatus(id);
  }

  @Post() create(@Param('moduleId') moduleId: string, @Body() dto: CreateFeatureDto) {
    return this.service.create(moduleId, dto);
  }

  @Post('reorder') @ApiOperation({ summary: 'Set the manual order of features within a module' })
  reorder(@Param('moduleId') moduleId: string, @Body() dto: ReorderFeaturesDto) {
    return this.service.reorder(moduleId, dto.orderedIds);
  }

  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateFeatureDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id') remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

/** Standalone feature lookup — used by FeaturePage which only knows the featureId, not the moduleId */
@ApiTags('features') @ApiBearerAuth() @Controller('features')
export class FeatureDetailController {
  constructor(
    private readonly service: FeaturesService,
    private readonly statsService: StatsService,
  ) {}

  @Get(':id') @ApiOperation({ summary: 'Get a single feature by ID' })
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Get(':id/stats') @ApiOperation({ summary: 'Get stats for a single feature' })
  getSingleStats(@Param('id') id: string, @Query('envId') envId?: string) {
    return this.statsService.computeFeatureStats(id, envId ?? null);
  }

  @Get(':id/draft-status') @ApiOperation({ summary: 'Get draft/publish status for a feature' })
  draftStatus(@Param('id') id: string) { return this.service.getDraftStatus(id); }

  @Put(':id') @ApiOperation({ summary: 'Update a feature by ID' })
  update(@Param('id') id: string, @Body() dto: UpdateFeatureDto) { return this.service.update(id, dto); }

  @Delete(':id') @ApiOperation({ summary: 'Delete a feature by ID' })
  remove(@Param('id') id: string) { return this.service.remove(id); }
}

/**
 * Project-scoped bulk operations on features. Features normally live under
 * `/modules/:moduleId/features`, but bulk move/archive crosses modules so we
 * mount these at the project level where the org-admin gate makes sense.
 */
@ApiTags('features') @ApiBearerAuth() @Controller('projects/:projectId/features')
export class FeaturesBulkController {
  constructor(
    private readonly service: FeaturesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get() @ApiOperation({ summary: 'List all features in a project (grouped by module on the client side)' })
  listByProject(@Param('projectId') projectId: string) {
    return this.prisma.feature.findMany({
      where: { deletedAt: null, module: { projectId, deletedAt: null } },
      select: {
        id: true,
        name: true,
        moduleId: true,
        automatedTestingEnabled: true,
        module: { select: { id: true, name: true } },
      },
      orderBy: [{ module: { order: 'asc' } }, { order: 'asc' }, { name: 'asc' }],
    });
  }

  @Get('browse') @ApiOperation({ summary: 'Paginated / filterable feature browser (search, tags, epics, sort)' })
  browse(
    @Param('projectId') projectId: string,
    @Query() q: {
      page?: string; limit?: string; search?: string;
      moduleId?: string; tags?: string; epics?: string;
      sort?: 'updated_desc' | 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc';
    },
  ) {
    return this.service.browse(projectId, {
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      search: q.search,
      moduleId: q.moduleId || undefined,
      tags: q.tags ? q.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      epics: q.epics ? q.epics.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      sort: q.sort,
    });
  }

  @Get('tags') @ApiOperation({ summary: 'Distinct feature tags in the project' })
  tags(@Param('projectId') projectId: string) {
    return this.service.getDistinctTags(projectId);
  }

  @Get('epics') @ApiOperation({ summary: 'Distinct linked epics (tracker-agnostic) — empty when no plugin/epics' })
  epics(@Param('projectId') projectId: string) {
    return this.service.getDistinctEpics(projectId);
  }

  @Post('bulk-archive') @ApiOperation({ summary: 'Bulk archive features (ORG_ADMIN of project)' })
  async bulkArchive(
    @Param('projectId') projectId: string,
    @Body() body: { ids: string[] },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertOrgAdminForProject(projectId, user);
    return this.service.bulkArchive(projectId, body?.ids ?? []);
  }

  @Post('bulk-move') @ApiOperation({ summary: 'Bulk move features to another module in same project (ORG_ADMIN)' })
  async bulkMove(
    @Param('projectId') projectId: string,
    @Body() body: { featureIds: string[]; targetModuleId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertOrgAdminForProject(projectId, user);
    return this.service.bulkMove(projectId, body?.featureIds ?? [], body?.targetModuleId);
  }

  private async assertOrgAdminForProject(projectId: string, user: JwtPayload): Promise<void> {
    if (user.platformRole === 'PLATFORM_ADMIN') return;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (user.activeOrgId !== project.orgId || user.orgRole !== 'ORG_ADMIN') {
      throw new ForbiddenException('Only ORG_ADMIN of this project\'s organisation can perform bulk feature actions.');
    }
  }
}
