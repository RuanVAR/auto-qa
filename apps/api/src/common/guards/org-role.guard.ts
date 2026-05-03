import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from '../decorators/current-user.decorator';

export const ORG_ROLES_KEY = 'org_roles';
export const OrgRoles = (...roles: string[]) => SetMetadata(ORG_ROLES_KEY, roles);

@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<string[]>(ORG_ROLES_KEY, context.getHandler());
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    const user = request.user;

    // PLATFORM_ADMIN bypasses all org role checks
    if (user?.platformRole === 'PLATFORM_ADMIN') return true;

    if (!user?.orgRole || !required.includes(user.orgRole)) {
      throw new ForbiddenException('Insufficient organisation role.');
    }
    return true;
  }
}
