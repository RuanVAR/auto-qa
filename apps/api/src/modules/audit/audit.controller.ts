import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRoleGuard, OrgRoles } from '../../common/guards/org-role.guard';
import { AuditService } from './audit.service';

/**
 * Org-admin audit viewer. Org-scoped + ORG_ADMIN-gated (the global guard has
 * already authenticated the request; OrgRoleGuard checks :orgId membership +
 * role). Lets an admin answer "which user/token did what, from where, and what
 * changed" for their own org.
 */
@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(OrgRoleGuard)
@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('orgs/:orgId/audit-logs')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Org-scoped audit feed (filterable, cursor-paginated)' })
  forOrg(
    @Param('orgId') orgId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('source') source?: string,
    @Query('entity') entity?: string,
    @Query('apiTokenId') apiTokenId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.audit.findForOrg(orgId, {
      limit: limit ? Number(limit) : undefined,
      cursor: cursor || undefined,
      userId: userId || undefined,
      action: action || undefined,
      source: source || undefined,
      entity: entity || undefined,
      apiTokenId: apiTokenId || undefined,
      from: from || undefined,
      to: to || undefined,
    });
  }
}
