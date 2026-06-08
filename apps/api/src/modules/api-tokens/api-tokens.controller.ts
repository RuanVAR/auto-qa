import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiTokensService } from './api-tokens.service';

/**
 * Personal access token management — always under the logged-in user (`/me`).
 * Guarded with the plain JWT guard (you manage tokens from the web app, signed
 * in); a PAT cannot mint or manage other PATs.
 */
@ApiTags('api-tokens')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/api-tokens')
export class ApiTokensController {
  constructor(private readonly service: ApiTokensService) {}

  @Get()
  @ApiOperation({ summary: "List the current user's API/MCP tokens (never the secret)" })
  list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Create a token — returns the plaintext ONCE' })
  create(@CurrentUser() user: JwtPayload, @Body() body: { name: string; expiresInDays?: number | null }, @Req() req: ReqLike) {
    return this.service.issue(user.sub, { name: body?.name, expiresInDays: body?.expiresInDays }, ctxFrom(user, req));
  }

  @Post(':id/regenerate')
  @ApiOperation({ summary: 'Rotate a token in place — old secret stops working, returns the new plaintext once' })
  regenerate(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Req() req: ReqLike) {
    return this.service.regenerate(user.sub, id, ctxFrom(user, req));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a token' })
  async revoke(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Req() req: ReqLike) {
    await this.service.revoke(user.sub, id, ctxFrom(user, req));
  }
}

type ReqLike = { ip?: string; headers: Record<string, string | undefined> };

function ctxFrom(user: JwtPayload, req: ReqLike) {
  return {
    orgId: user.activeOrgId ?? null,
    ip: (req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.ip) ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}
