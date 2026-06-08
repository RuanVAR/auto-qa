import { Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { McpService } from './mcp.service';

/**
 * MCP endpoint (Streamable HTTP). Authenticated by the global JwtOrApiTokenGuard,
 * so a `qapt_…` token (or a JWT) resolves to req.user and tools run with that
 * user's RBAC. Mounted at /api/v1/mcp so the existing /api nginx proxy serves it
 * — point your MCP client at https://<platform>/api/v1/mcp with
 * `Authorization: Bearer qapt_…`.
 */
@ApiTags('mcp')
@ApiBearerAuth()
@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Post()
  @ApiOperation({ summary: 'MCP Streamable-HTTP endpoint (JSON-RPC messages)' })
  post(@Req() req: McpReq, @Res() res: FastifyReply, @CurrentUser() user: JwtPayload): Promise<void> {
    return this.route(req, res, user);
  }

  @Get()
  @ApiOperation({ summary: 'MCP Streamable-HTTP SSE stream (requires a session)' })
  get(@Req() req: McpReq, @Res() res: FastifyReply, @CurrentUser() user: JwtPayload): Promise<void> {
    return this.route(req, res, user);
  }

  @Delete()
  @ApiOperation({ summary: 'Terminate an MCP session' })
  del(@Req() req: McpReq, @Res() res: FastifyReply, @CurrentUser() user: JwtPayload): Promise<void> {
    return this.route(req, res, user);
  }

  private route(req: McpReq, res: FastifyReply, user: JwtPayload): Promise<void> {
    return this.mcp.handle(
      req.raw,
      res.raw,
      req.body,
      { sub: user.sub, orgRole: user.orgRole, platformRole: user.platformRole, activeOrgId: user.activeOrgId },
      { ip: clientIp(req), userAgent: (req.headers['user-agent'] as string | undefined) ?? null, apiTokenId: req.apiTokenId ?? null },
    );
  }
}

type McpReq = FastifyRequest & { apiTokenId?: string };

function clientIp(req: FastifyRequest): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
  return req.ip ?? null;
}
