import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { EnvAccessService } from '../../common/access/env-access.service';
import { accessCtx } from '../../common/access/access-context';
import { SharedStepsService } from './shared-steps.service';

@ApiTags('shared-steps') @ApiBearerAuth() @Controller('projects/:projectId/shared-steps')
export class SharedStepsController {
  constructor(private readonly service: SharedStepsService, private readonly access: EnvAccessService) {}
  private read(projectId: string, user: JwtPayload) { return this.access.assertProjectAccess(user.sub, projectId, accessCtx(user)); }
  private write(projectId: string, user: JwtPayload) { return this.access.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user)); }
  private isOrgAdmin(user: JwtPayload) { return user.orgRole === 'ORG_ADMIN' || user.platformRole === 'PLATFORM_ADMIN'; }

  @Get() async list(@Param('projectId') projectId: string, @Query('includeArchived') includeArchived: string | undefined, @CurrentUser() user: JwtPayload) { await this.read(projectId, user); return this.service.list(projectId, includeArchived === 'true'); }
  @Get('folders') async folders(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) { await this.read(projectId, user); return this.service.listFolders(projectId); }
  @Post('folders') async createFolder(@Param('projectId') projectId: string, @Body() body: { name: string; parentId?: string }, @CurrentUser() user: JwtPayload) { await this.write(projectId, user); return this.service.createFolder(projectId, body, user.sub); }
  @Post() async create(@Param('projectId') projectId: string, @Body() body: any, @CurrentUser() user: JwtPayload) { await this.write(projectId, user); return this.service.create(projectId, body, user.sub); }
  @Patch(':id') async update(@Param('projectId') projectId: string, @Param('id') id: string, @Body() body: any, @CurrentUser() user: JwtPayload) { await this.write(projectId, user); return this.service.update(projectId, id, body, user.sub, this.isOrgAdmin(user)); }
  @Get(':id/dependents') async dependents(@Param('projectId') projectId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload) { await this.read(projectId, user); return this.service.dependents(projectId, id); }
  @Post(':id/archive') async archive(@Param('projectId') projectId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload) { await this.write(projectId, user); return this.service.archive(projectId, id, user.sub, true, this.isOrgAdmin(user)); }
  @Post(':id/restore') async restore(@Param('projectId') projectId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload) { await this.write(projectId, user); return this.service.archive(projectId, id, user.sub, false, this.isOrgAdmin(user)); }
  @Post('promote') async promote(@Param('projectId') projectId: string, @Body() body: { ids?: string[] }, @CurrentUser() user: JwtPayload) { await this.write(projectId, user); if (user.orgRole !== 'ORG_ADMIN' && user.platformRole !== 'PLATFORM_ADMIN') throw new ForbiddenException('Only an organisation admin may promote shared steps'); return this.service.promote(projectId, body.ids ?? [], user.sub); }
}
