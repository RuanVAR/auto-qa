import { Controller, Get, Post, Put, Delete, Param, Body, Query, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ModulesService } from './modules.service';
import { StatsService, parseRunMode } from '../stats/stats.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvAccessService } from '../../common/access/env-access.service';
import { clampLimit } from '../../common/util/pagination';
import { accessCtx } from '../../common/access/access-context';

@ApiTags('modules') @ApiBearerAuth()
@Controller('projects/:projectId/modules')
export class ModulesController {
  constructor(
    private readonly service: ModulesService,
    private readonly statsService: StatsService,
    private readonly prisma: PrismaService,
    private readonly envAccess: EnvAccessService,
  ) {}

  @Get() @ApiOperation({ summary: 'List modules for a project' })
  findAll(@Param('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Get('stats') @ApiOperation({ summary: 'Get stats for all modules in a project' })
  getStats(@Param('projectId') projectId: string, @Query('envId') envId?: string, @Query('mode') mode?: string) {
    return this.statsService.computeModuleStatsForProject(projectId, envId ?? null, parseRunMode(mode));
  }

  @Get('tags') @ApiOperation({ summary: 'Get distinct tags across all modules in a project' })
  async getTags(@Param('projectId') projectId: string) {
    const tags = await this.service.getDistinctTags(projectId);
    return { tags };
  }

  @Get('browse') @ApiOperation({ summary: 'Paginated / filterable module browser (search, tags, sort)' })
  browse(
    @Param('projectId') projectId: string,
    @Query() q: {
      page?: string; limit?: string; search?: string; tags?: string;
      sort?: 'order_asc' | 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc' | 'updated_desc';
    },
  ) {
    return this.service.browse(projectId, {
      page: q.page ? Number(q.page) : undefined,
      limit: clampLimit(q.limit, { max: 200 }),
      search: q.search,
      tags: q.tags ? q.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      sort: q.sort,
    });
  }

  @Get(':id') async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const m = await this.prisma.module.findFirst({ where: { id, deletedAt: null }, select: { projectId: true } });
    if (!m) throw new NotFoundException('Module not found');
    await this.envAccess.assertProjectAccess(user.sub, m.projectId, accessCtx(user));
    return this.service.findOne(id);
  }

  @Post() create(@Param('projectId') projectId: string, @Body() dto: CreateModuleDto) {
    return this.service.create(projectId, dto);
  }

  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateModuleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id') remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('bulk-archive') @ApiOperation({ summary: 'Bulk archive modules (ORG_ADMIN of the project\'s org)' })
  async bulkArchive(
    @Param('projectId') projectId: string,
    @Body() body: { ids: string[] },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertOrgAdminForProject(projectId, user);
    return this.service.bulkArchive(projectId, body?.ids ?? []);
  }

  private async assertOrgAdminForProject(projectId: string, user: JwtPayload): Promise<void> {
    if (user.platformRole === 'PLATFORM_ADMIN') return;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (user.activeOrgId !== project.orgId || user.orgRole !== 'ORG_ADMIN') {
      throw new ForbiddenException('Only ORG_ADMIN of this project\'s organisation can perform bulk archive.');
    }
  }
}
