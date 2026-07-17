import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AccessRequestsService } from './access-requests.service';
import { CreateAccessRequestDto } from './dto/create-access-request.dto';
import { ReviewAccessRequestDto } from './dto/review-access-request.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRoleGuard, OrgRoles } from '../../common/guards/org-role.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { EnvAccessService } from '../../common/access/env-access.service';
import { accessCtx } from '../../common/access/access-context';

/**
 * Access requests: a user asks to join an org / project, an admin approves.
 *
 * Authorization notes — these endpoints previously carried only JwtAuthGuard
 * while their Swagger summaries claimed "(ORG_ADMIN only)", so any authenticated
 * user could list and approve ANY request by id. Now:
 *   - org-scoped list/review are gated by OrgRoleGuard + @OrgRoles('ORG_ADMIN')
 *     (the guard resolves the caller's live role for :orgId from the DB);
 *   - project-scoped list/review require elevated project access
 *     (OWNER/TECH_LEAD, or ORG_ADMIN of the project's own org);
 *   - review calls pass their route scope down so an admin of org A cannot
 *     review a request belonging to org B by id.
 */
@ApiTags('access-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRoleGuard)
@Controller()
export class AccessRequestsController {
  constructor(
    private readonly service: AccessRequestsService,
    private readonly envAccess: EnvAccessService,
  ) {}

  // ── Org-scoped endpoints ──────────────────────────────────────────────────

  @Post('orgs/:orgId/access-requests')
  @ApiOperation({ summary: 'Request access to an organisation' })
  createOrgRequest(
    @Param('orgId') orgId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAccessRequestDto,
  ) {
    // Intentionally ungated: asking to join is open to any authenticated user.
    return this.service.createOrgRequest(orgId, user.sub, dto);
  }

  @Get('orgs/:orgId/access-requests')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'List access requests for an organisation (ORG_ADMIN only)' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  listOrgRequests(
    @Param('orgId') orgId: string,
    @Query('status') status?: string,
  ) {
    return this.service.listOrgRequests(orgId, status);
  }

  @Patch('orgs/:orgId/access-requests/:id')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Review (approve/reject) an org access request (ORG_ADMIN only)' })
  reviewOrgRequest(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReviewAccessRequestDto,
  ) {
    return this.service.reviewRequest(id, user.sub, dto, { orgId });
  }

  // ── Project-scoped endpoints ──────────────────────────────────────────────

  @Post('projects/:projectId/access-requests')
  @ApiOperation({ summary: 'Request access to a project' })
  createProjectRequest(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAccessRequestDto,
  ) {
    // The org is derived from the project inside the service — never from the
    // caller's active org, which may not be the project's org at all.
    return this.service.createProjectRequest(projectId, user.sub, dto);
  }

  @Get('projects/:projectId/access-requests')
  @ApiOperation({ summary: 'List access requests for a project (OWNER/TECH_LEAD/ORG_ADMIN only)' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  async listProjectRequests(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
  ) {
    await this.envAccess.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    return this.service.listProjectRequests(projectId, status);
  }

  @Patch('projects/:projectId/access-requests/:id')
  @ApiOperation({ summary: 'Review (approve/reject) a project access request' })
  async reviewProjectRequest(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReviewAccessRequestDto,
  ) {
    await this.envAccess.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    return this.service.reviewRequest(id, user.sub, dto, { projectId });
  }

  // ── Current user endpoint ─────────────────────────────────────────────────

  @Get('me/access-requests')
  @ApiOperation({ summary: 'List all access requests made by the current user' })
  listMyRequests(@CurrentUser() user: JwtPayload) {
    return this.service.listMyRequests(user.sub);
  }
}
