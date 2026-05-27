import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttler guard with one extra skip condition on top of the parent's.
 *
 * Two subtleties to know about @nestjs/throttler v6:
 *
 * 1. `shouldSkip()` is NOT where @SkipThrottle() is consumed. The parent's
 *    shouldSkip() unconditionally returns false; the decorator is read
 *    inside canActivate's per-named-throttler loop via the metadata key
 *    `THROTTLER_SKIP + <name>`. We still delegate to super.shouldSkip() so
 *    future versions / mixins behave correctly.
 *
 * 2. `@SkipThrottle()` with no args defaults to `{ default: true }`. Our
 *    app.module config uses NAMED throttlers (`global`, `auth`) — so the
 *    no-arg form is a silent no-op against our setup. Always pass
 *    `@SkipThrottle({ global: true, auth: true })`. See health.controller
 *    for the canonical example.
 *
 * Layered on top: a dev-only smoke-test header escape hatch. Production
 * behaviour is unchanged — decorator-skip-or-throttle.
 */
@Injectable()
export class SmokeAwareThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    // 1. Delegate to parent. (Currently always false in v6, but kept for
    //    forward-compatibility — never replace the parent's decision.)
    if (await super.shouldSkip(context)) return true;

    // 2. Smoke-test escape hatch (header-based, dev only).
    if (process.env.NODE_ENV === 'production') return false;
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    return req.headers['x-smoke-test'] === '1';
  }
}
