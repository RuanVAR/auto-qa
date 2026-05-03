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
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('access-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AccessRequestsController {
  constructor(private readonly service: AccessRequestsService) {}

  // ── Org-scoped endpoints ──────────────────────────────────────────────────

  @Post('orgs/:orgId/access-requests')
  @ApiOperation({ summary: 'Request access to an organisation' })
  createOrgRequest(
    @Param('orgId') orgId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAccessRequestDto,
  ) {
    return this.service.createOrgRequest(orgId, user.sub, dto);
  }

  @Get('orgs/:orgId/access-requests')
  @ApiOperation({ summary: 'List access requests for an organisation (ORG_ADMIN only)' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  listOrgRequests(
    @Param('orgId') orgId: string,
    @Query('status') status?: string,
  ) {
    return this.service.listOrgRequests(orgId, status);
  }

  @Patch('orgs/:orgId/access-requests/:id')
  @ApiOperation({ summary: 'Review (approve/reject) an org access request (ORG_ADMIN only)' })
  reviewOrgRequest(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReviewAccessRequestDto,
  ) {
    return this.service.reviewRequest(id, user.sub, dto);
  }

  // ── Project-scoped endpoints ──────────────────────────────────────────────

  @Post('projects/:projectId/access-requests')
  @ApiOperation({ summary: 'Request access to a project' })
  createProjectRequest(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAccessRequestDto,
  ) {
    const orgId = user.activeOrgId ?? '';
    return this.service.createProjectRequest(orgId, projectId, user.sub, dto);
  }

  @Get('projects/:projectId/access-requests')
  @ApiOperation({ summary: 'List access requests for a project (OWNER/ORG_ADMIN only)' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  listProjectRequests(
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
  ) {
    return this.service.listProjectRequests(projectId, status);
  }

  @Patch('projects/:projectId/access-requests/:id')
  @ApiOperation({ summary: 'Review (approve/reject) a project access request' })
  reviewProjectRequest(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReviewAccessRequestDto,
  ) {
    return this.service.reviewRequest(id, user.sub, dto);
  }

  // ── Current user endpoint ─────────────────────────────────────────────────

  @Get('me/access-requests')
  @ApiOperation({ summary: 'List all access requests made by the current user' })
  listMyRequests(@CurrentUser() user: JwtPayload) {
    return this.service.listMyRequests(user.sub);
  }
}
