import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { ContextService, AccessCtx } from './context.service';

/**
 * Read-only context endpoints: a test or feature + its scope, acceptance
 * criteria and linked docs. RBAC-checked in the service (assertProjectAccess).
 * Used by the MCP `get_*_context` tools and any developer integration.
 */
@ApiTags('context')
@ApiBearerAuth()
@Controller()
export class ContextController {
  constructor(private readonly context: ContextService) {}

  @Get('tests/:id/context')
  @ApiOperation({ summary: 'A test + its scope, acceptance criteria and linked docs' })
  forTest(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.context.forTest(id, ctx(user));
  }

  @Get('features/:id/context')
  @ApiOperation({ summary: 'A feature + its scope, acceptance criteria, docs and tests' })
  forFeature(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.context.forFeature(id, ctx(user));
  }
}

function ctx(user: JwtPayload): AccessCtx {
  return {
    userId: user.sub,
    jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
    orgId: user.activeOrgId,
  };
}
