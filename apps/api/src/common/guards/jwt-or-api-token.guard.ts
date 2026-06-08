import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ApiTokensService } from '../../modules/api-tokens/api-tokens.service';

/**
 * Global auth guard accepting EITHER a JWT (the web app) OR a personal access
 * token (`qapt_…`, used by the MCP server and direct API access). PAT requests
 * are resolved to the same `req.user` shape the JWT strategy produces, with the
 * owner's live RBAC — so every existing endpoint works with a token, and
 * `EnvAccessService` enforces access uniformly. Non-PAT requests fall through to
 * the unchanged JWT strategy.
 */
@Injectable()
export class JwtOrApiTokenGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiTokens: ApiTokensService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      ip?: string;
      user?: unknown;
      authSource?: string;
      apiTokenId?: string;
    }>();
    const raw = req.headers['authorization'] ?? req.headers['Authorization'];
    const bearer = typeof raw === 'string' && raw.startsWith('Bearer ') ? raw.slice(7).trim() : null;

    if (bearer && bearer.startsWith('qapt_')) {
      const ip = clientIp(req);
      const resolved = await this.apiTokens.validate(bearer, ip);
      if (!resolved) throw new UnauthorizedException('Invalid or expired API token');
      const user = await this.apiTokens.resolveUserContext(resolved.userId);
      if (!user) throw new UnauthorizedException('Account inactive');
      req.user = user;
      req.authSource = 'api-token';
      req.apiTokenId = resolved.tokenId;
      return true;
    }

    // Not a PAT — defer to the standard JWT strategy (unchanged behaviour).
    return (await super.canActivate(context)) as boolean;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRequest<TUser = any>(err: Error, user: TUser): TUser {
    if (err || !user) throw err ?? new UnauthorizedException('Authentication required');
    return user;
  }
}

function clientIp(req: { headers: Record<string, string | undefined>; ip?: string }): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.ip ?? null;
}
