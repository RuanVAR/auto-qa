import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SelectorHealsService } from './selector-heals.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { EnvAccessService } from '../../common/access/env-access.service';
import { UpdateSelectorHealSettingsDto } from './dto/update-selector-heal-settings.dto';

@ApiTags('selector-heals') @ApiBearerAuth() @Controller()
export class SelectorHealsController {
  constructor(
    private readonly service: SelectorHealsService,
    private readonly envAccess: EnvAccessService,
  ) {}

  @Get('projects/:projectId/selector-heals/pending')
  @ApiOperation({ summary: 'Selector drift detection: pending heals awaiting promotion review' })
  async listPending(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole }, orgId: user.activeOrgId,
    });
    return this.service.listPending(projectId);
  }

  @Get('projects/:projectId/selector-heals/settings')
  @ApiOperation({ summary: 'Get selector-heal promotion policy for a project' })
  async getSettings(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole }, orgId: user.activeOrgId,
    });
    return this.service.getSettings(projectId);
  }

  @Patch('projects/:projectId/selector-heals/settings')
  @ApiOperation({ summary: 'Configure elevated selector-heal auto-promotion policy' })
  async updateSettings(
    @Param('projectId') projectId: string,
    @Body() dto: UpdateSelectorHealSettingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.envAccess.assertElevatedProjectAccess(user.sub, projectId, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole }, orgId: user.activeOrgId,
    });
    return this.service.updateSettings(projectId, dto);
  }

  @Post('selector-heals/:id/promote')
  @ApiOperation({ summary: 'Promote a healed selector to primary (demotes the current primary into fallbacks)' })
  async promote(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const projectId = await this.service.projectIdOf(id);
    await this.envAccess.assertProjectAccess(user.sub, projectId, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole }, orgId: user.activeOrgId,
    });
    return this.service.promote(id, user.sub);
  }

  @Post('selector-heals/:id/dismiss')
  @ApiOperation({ summary: 'Decline a heal — drops it from the review queue without touching the stored step' })
  async dismiss(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const projectId = await this.service.projectIdOf(id);
    await this.envAccess.assertProjectAccess(user.sub, projectId, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole }, orgId: user.activeOrgId,
    });
    return this.service.dismiss(id);
  }
}
