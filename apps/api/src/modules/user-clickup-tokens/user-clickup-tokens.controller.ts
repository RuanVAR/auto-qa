import { Body, Controller, Delete, Get, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { UserClickUpTokenService } from './user-clickup-tokens.service';

/**
 * Self-service management of the logged-in user's personal ClickUp token — always
 * under `/me` and scoped to their active org's ClickUp install. JWT-guarded (you
 * manage this from the web app). The secret is never returned.
 */
@ApiTags('user-clickup-token')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/clickup-token')
export class UserClickUpTokenController {
  constructor(private readonly service: UserClickUpTokenService) {}

  @Get()
  @ApiOperation({ summary: 'Status of the user’s ClickUp token for their active org (no secret)' })
  status(@CurrentUser() user: JwtPayload) {
    return this.service.status(user.sub, user.activeOrgId ?? null);
  }

  @Put()
  @ApiOperation({ summary: 'Validate + store the user’s ClickUp personal token; auto-links them as a CU assignee' })
  set(@CurrentUser() user: JwtPayload, @Body() body: { token: string }, @Req() req: ReqLike) {
    return this.service.set(user.sub, user.activeOrgId ?? null, body?.token, ctxFrom(req));
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove the user’s ClickUp token (assignee link is left intact)' })
  remove(@CurrentUser() user: JwtPayload, @Req() req: ReqLike) {
    return this.service.remove(user.sub, user.activeOrgId ?? null, ctxFrom(req));
  }
}

type ReqLike = { ip?: string; headers: Record<string, string | undefined> };

function ctxFrom(req: ReqLike) {
  return {
    ip: (req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.ip) ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}
