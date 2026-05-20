import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class SmokeAwareThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (process.env.NODE_ENV === 'production') return false;
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    return req.headers['x-smoke-test'] === '1';
  }
}
