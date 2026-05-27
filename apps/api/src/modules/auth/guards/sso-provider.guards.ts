import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isProviderEnabled } from '../auth.module';

/**
 * Pre-guard that ensures the SSO provider is enabled BEFORE Passport's
 * AuthGuard runs. When a provider is disabled at boot we never register
 * its Passport strategy, so the AuthGuard would otherwise throw an
 * unhandled 500 ("Unknown authentication strategy"). Returning a clean
 * 404 from here is what lets the frontend treat a disabled provider
 * identically to "feature off everywhere else".
 *
 * Guard execution order matters — list this BEFORE `AuthGuard('xxx')`
 * in @UseGuards(...) so it short-circuits before passport touches the
 * request:
 *
 *   @UseGuards(GoogleEnabledGuard, AuthGuard('google'))
 */
@Injectable()
export class GoogleEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(_ctx: ExecutionContext): boolean {
    if (!isProviderEnabled(this.config, 'GOOGLE')) {
      throw new NotFoundException('google SSO is not enabled on this deployment');
    }
    return true;
  }
}

@Injectable()
export class MicrosoftEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(_ctx: ExecutionContext): boolean {
    if (!isProviderEnabled(this.config, 'MICROSOFT')) {
      throw new NotFoundException('microsoft SSO is not enabled on this deployment');
    }
    return true;
  }
}
