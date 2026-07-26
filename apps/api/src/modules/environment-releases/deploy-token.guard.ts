import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DeployTokensService } from './deploy-tokens.service';

interface DeployRequest {
  params: { projectId?: string; environmentId?: string };
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  deployTokenId?: string;
  deployTokenOrgId?: string;
}

@Injectable()
export class DeployTokenGuard implements CanActivate {
  constructor(private readonly tokens: DeployTokensService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeployRequest>();
    const projectId = request.params.projectId;
    const environmentId = request.params.environmentId;
    if (!projectId || !environmentId) {
      throw new UnauthorizedException('Deployment route is missing project or environment context');
    }
    const authorization = first(request.headers.authorization);
    const plaintext = authorization?.startsWith('Bearer ')
      ? authorization.slice(7).trim()
      : '';
    if (!plaintext) throw new UnauthorizedException('Deployment token is required');
    const result = await this.tokens.validate(
      plaintext,
      projectId,
      environmentId,
      clientIp(request),
    );
    request.deployTokenId = result.tokenId;
    request.deployTokenOrgId = result.orgId;
    return true;
  }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clientIp(request: DeployRequest): string | null {
  const forwarded = first(request.headers['x-forwarded-for']);
  return forwarded?.split(',')[0]?.trim() ?? request.ip ?? null;
}
