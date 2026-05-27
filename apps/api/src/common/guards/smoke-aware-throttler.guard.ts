import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Adds a dev-only `x-smoke-test: 1` header skip on top of standard throttling.
 * @SkipThrottle uses must pass named throttlers explicitly: `{ global: true, auth: true }`.
 */
@Injectable()
export class SmokeAwareThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (await super.shouldSkip(context)) return true;
    if (process.env.NODE_ENV === 'production') return false;
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    return req.headers['x-smoke-test'] === '1';
  }
}
