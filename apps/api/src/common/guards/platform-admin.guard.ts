import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { JwtPayload } from '../decorators/current-user.decorator';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    const user = request.user;
    if (!user || user.platformRole !== 'PLATFORM_ADMIN') {
      throw new ForbiddenException('Platform administrator access required.');
    }
    return true;
  }
}
