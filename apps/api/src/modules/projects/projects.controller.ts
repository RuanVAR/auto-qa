import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { UserRole, ProjectRole } from '@prisma/client';
import { ProjectsService } from './projects.service';
import { StatsService } from '../stats/stats.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvAccessService } from '../../common/access/env-access.service';

@ApiTags('projects') @ApiBearerAuth() @Controller('projects')
export class ProjectsController {
  constructor(
    private readonly service: ProjectsService,
    private readonly statsService: StatsService,
    private readonly prisma: PrismaService,
    private readonly envAccess: EnvAccessService,
  ) {}

  @Get() @ApiOperation({ summary: 'List all projects' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.service.findAll(user.sub, user.activeOrgId ?? undefined, user.orgRole ?? undefined);
  }

  @Get(':id') @ApiOperation({ summary: 'Get a project by id' })
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Get(':id/stats') @ApiOperation({ summary: 'Get aggregated stats for a project' })
  getStats(@Param('id') id: string, @Query('envId') envId?: string) {
    return this.statsService.computeProjectStats(id, envId ?? null);
  }

  /**
   * Side-by-side per-env breakdown for managers / org admins.
   * Returns one row per environment in the project, with pass/fail/cancel
   * counts plus the most recent run timestamp. Lets reports answer
   * "how is QA doing vs UAT" at a glance without N round-trips.
   */
  @Get(':id/stats/by-env')
  @ApiOperation({ summary: 'Per-environment rollup for side-by-side reporting' })
  async getStatsByEnv(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('since') since?: string,
  ) {
    const sinceDate = since ? new Date(since) : null;
    // Restrict the rollup to envs the caller can actually see — a UAT-only
    // tester shouldn't get QA's pass rate even in a side-by-side view.
    const allowedEnvIds = await this.envAccess.getAllowedEnvIds(user.sub, id, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
    });
    const envs = await this.prisma.environment.findMany({
      where: {
        projectId: id,
        deletedAt: null,
        ...(allowedEnvIds !== null ? { id: { in: allowedEnvIds } } : {}),
      },
      select: { id: true, name: true, type: true, baseUrl: true },
      orderBy: { createdAt: 'asc' },
    });
    const rollups = await Promise.all(envs.map(async (env) => {
      const where = {
        projectId: id,
        environmentId: env.id,
        ...(sinceDate ? { createdAt: { gte: sinceDate } } : {}),
      };
      const grouped = await this.prisma.testRun.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      });
      const lastRun = await this.prisma.testRun.findFirst({
        where, orderBy: { createdAt: 'desc' }, select: { createdAt: true, status: true },
      });
      const counts = { passed: 0, failed: 0, cancelled: 0, error: 0, running: 0, pending: 0 };
      for (const g of grouped) {
        const k = (g.status as string).toLowerCase() as keyof typeof counts;
        if (k in counts) counts[k] = g._count._all;
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const passRate = total > 0 ? Math.round((counts.passed / total) * 100) : null;
      return { environment: env, counts, total, passRate, lastRunAt: lastRun?.createdAt ?? null, lastRunStatus: lastRun?.status ?? null };
    }));
    return rollups;
  }

  @Post() @ApiOperation({ summary: 'Create a project' })
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub, user.activeOrgId);
  }

  @Put(':id') @ApiOperation({ summary: 'Update a project' })
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto, @CurrentUser() user: JwtPayload) {
    return this.service.update(id, dto, user.sub);
  }

  @Delete(':id') @Roles(UserRole.ADMIN) @ApiOperation({ summary: 'Archive a project (admin only)' })
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(id, user.sub);
  }
}

// ─── Member access management ────────────────────────────────────────────────

class UpsertProjectMemberDto {
  @ApiProperty() @IsString() @IsNotEmpty() userId!: string;
  @ApiProperty({ enum: ProjectRole }) @IsEnum(ProjectRole) role!: ProjectRole;
  // Empty array → access to ALL environments. Non-empty → restricted list.
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() allowedEnvironmentIds?: string[];
}

class UpdateProjectMemberDto {
  @ApiPropertyOptional({ enum: ProjectRole }) @IsOptional() @IsEnum(ProjectRole) role?: ProjectRole;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() allowedEnvironmentIds?: string[];
}

/**
 * Project membership + per-env access control.
 *
 * The schema's ProjectMember.allowedEnvironmentIds field already supports the
 * "Bob can access QA + UAT but not PROD" model. These endpoints expose it so
 * org admins / project owners can actually manage it.
 *
 * Authorization: only org admins or project OWNER/TECH_LEAD can mutate. We
 * resolve the caller's role lazily from the DB rather than trusting the JWT
 * for the project role (JWT only carries the active org role).
 */
@ApiTags('project-members') @ApiBearerAuth() @Controller('projects/:projectId/members')
export class ProjectMembersController {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCanManage(projectId: string, user: JwtPayload): Promise<void> {
    if (user.orgRole === 'ORG_ADMIN' || user.platformRole === 'PLATFORM_ADMIN') return;
    const m = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.sub } },
    });
    if (!m) throw new ForbiddenException('Not a member of this project');
    if (m.role !== ProjectRole.OWNER && m.role !== ProjectRole.TECH_LEAD) {
      throw new ForbiddenException('Only project owners or tech leads can manage members');
    }
  }

  @Get()
  @ApiOperation({ summary: 'List members of a project with their allowed envs' })
  async list(@Param('projectId') projectId: string) {
    return this.prisma.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { id: true, name: true, email: true, accountStatus: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post()
  @ApiOperation({ summary: 'Add a user to the project with role + optional env restriction' })
  async add(
    @Param('projectId') projectId: string,
    @Body() dto: UpsertProjectMemberDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertCanManage(projectId, user);
    // Verify all envIds belong to this project — prevents cross-project leaks
    // where an admin pastes an env id from another project by mistake.
    if (dto.allowedEnvironmentIds && dto.allowedEnvironmentIds.length > 0) {
      const valid = await this.prisma.environment.count({
        where: { id: { in: dto.allowedEnvironmentIds }, projectId },
      });
      if (valid !== dto.allowedEnvironmentIds.length) {
        throw new BadRequestException('One or more envIds do not belong to this project');
      }
    }
    return this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: dto.userId } },
      update: { role: dto.role, allowedEnvironmentIds: dto.allowedEnvironmentIds ?? [] },
      create: { projectId, userId: dto.userId, role: dto.role, allowedEnvironmentIds: dto.allowedEnvironmentIds ?? [] },
    });
  }

  @Patch(':userId')
  @ApiOperation({ summary: 'Update a member\'s role or env restrictions' })
  async update(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateProjectMemberDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertCanManage(projectId, user);
    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!existing) throw new NotFoundException('Member not found');
    if (dto.allowedEnvironmentIds && dto.allowedEnvironmentIds.length > 0) {
      const valid = await this.prisma.environment.count({
        where: { id: { in: dto.allowedEnvironmentIds }, projectId },
      });
      if (valid !== dto.allowedEnvironmentIds.length) {
        throw new BadRequestException('One or more envIds do not belong to this project');
      }
    }
    return this.prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: {
        ...(dto.role ? { role: dto.role } : {}),
        ...(dto.allowedEnvironmentIds !== undefined ? { allowedEnvironmentIds: dto.allowedEnvironmentIds } : {}),
      },
    });
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Remove a member from the project' })
  async remove(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertCanManage(projectId, user);
    return this.prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId } },
    });
  }
}
