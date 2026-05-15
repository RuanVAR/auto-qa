import { Controller, Get, Post, Put, Delete, Param, Body, Query, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ModulesService } from './modules.service';
import { StatsService } from '../stats/stats.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';

@ApiTags('modules') @ApiBearerAuth()
@Controller('projects/:projectId/modules')
export class ModulesController {
  constructor(
    private readonly service: ModulesService,
    private readonly statsService: StatsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get() @ApiOperation({ summary: 'List modules for a project' })
  findAll(@Param('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Get('stats') @ApiOperation({ summary: 'Get stats for all modules in a project' })
  getStats(@Param('projectId') projectId: string, @Query('envId') envId?: string) {
    return this.statsService.computeModuleStatsForProject(projectId, envId ?? null);
  }

  @Get('tags') @ApiOperation({ summary: 'Get distinct tags across all modules in a project' })
  async getTags(@Param('projectId') projectId: string) {
    const tags = await this.service.getDistinctTags(projectId);
    return { tags };
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }

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
