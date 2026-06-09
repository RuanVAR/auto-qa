import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { EnvironmentsService } from './environments.service';
import { CreateEnvironmentDto } from './dto/create-environment.dto';
import { UpdateEnvironmentDto } from './dto/update-environment.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';

@ApiTags('environments') @ApiBearerAuth() @Controller('projects/:projectId/environments')
export class EnvironmentsController {
  constructor(
    private readonly service: EnvironmentsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * List envs the caller is allowed to see in this project. Org admins and
   * platform admins see everything. Project members see all envs unless their
   * ProjectMember.allowedEnvironmentIds is non-empty, in which case the list
   * is filtered. Non-members fall back to the unfiltered list (the existing
   * project-scope guard handles the "is this user even in this project" case).
   */
  @Get()
  async findAll(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const all = await this.service.findByProject(projectId, {
      includeArchived: includeArchived === 'true' || includeArchived === '1',
    });
    if (user.orgRole === 'ORG_ADMIN' || user.platformRole === 'PLATFORM_ADMIN') return all;
    const m = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.sub } },
    });
    if (!m) return all; // non-members: handled at a higher guard layer
    if (m.role === 'OWNER' || m.role === 'TECH_LEAD') return all;
    if (m.allowedEnvironmentIds.length === 0) return all; // empty = unrestricted
    const allowed = new Set(m.allowedEnvironmentIds);
    return all.filter((e: { id: string }) => allowed.has(e.id));
  }
  // NB: declared before @Get(':id') so "my-preference" isn't matched as an :id.
  @Get('my-preference')
  @ApiOperation({ summary: "Get the caller's saved environment for this project" })
  getMyPreference(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    return this.service.getEnvPreference(user.sub, projectId);
  }

  @Put('my-preference')
  @ApiOperation({ summary: "Persist the caller's working environment for this project" })
  setMyPreference(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { environmentId: string },
  ) {
    return this.service.setEnvPreference(user.sub, projectId, body.environmentId);
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() create(@Param('projectId') projectId: string, @Body() dto: CreateEnvironmentDto) { return this.service.create(projectId, dto); }
  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateEnvironmentDto) { return this.service.update(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
  @Post(':id/restore')
  @ApiOperation({ summary: 'Restore an archived environment back to active' })
  restore(@Param('id') id: string) { return this.service.restore(id); }

  @Get(':id/iframe-check')
  @ApiOperation({ summary: 'Check if environment URL can be embedded in iframe' })
  async iframeCheck(@Param('id') id: string) {
    return this.service.checkIframeEmbeddability(id);
  }
}
