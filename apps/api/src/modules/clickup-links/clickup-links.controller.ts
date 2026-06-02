import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRoleGuard, OrgRoles } from '../../common/guards/org-role.guard';
import { ClickUpLinksService } from './clickup-links.service';

@ApiTags('clickup-links') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRoleGuard)
@Controller('orgs/:orgId/clickup')
export class ClickUpLinksController {
  constructor(private readonly service: ClickUpLinksService) {}

  @Get('health')
  @ApiOperation({ summary: 'Whether a usable (installed + healthy) ClickUp install exists' })
  health(@Param('orgId') orgId: string) {
    return this.service.getHealth(orgId);
  }

  @Get('members')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'ClickUp workspace members + QA links + email auto-match suggestions' })
  members(@Param('orgId') orgId: string) {
    return this.service.getMembers(orgId);
  }

  @Put('links')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Link a QA user to a ClickUp user (one-to-one per workspace)' })
  link(
    @Param('orgId') orgId: string,
    @Body() body: { qaUserId: string; clickupUserId: number; clickupUsername?: string; clickupEmail?: string },
  ) {
    return this.service.link(orgId, body);
  }

  @Delete('links/:qaUserId')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Remove a QA user’s ClickUp link' })
  unlink(@Param('orgId') orgId: string, @Param('qaUserId') qaUserId: string) {
    return this.service.unlink(orgId, qaUserId);
  }
}
