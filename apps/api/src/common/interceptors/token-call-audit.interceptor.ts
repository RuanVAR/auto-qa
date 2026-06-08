import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../../modules/audit/audit.service';

/**
 * Per-call audit for personal-access-token traffic. Only fires when the request
 * was authenticated by a PAT (the guard sets `req.authSource='api-token'`), so
 * normal web/JWT traffic is untouched. Records one `API_CALL` row per request —
 * method + route + status + user + token + IP — giving org admins a complete
 * "what did each token do" trail. MCP tool calls get their own richer audit in
 * a later phase; this covers all direct REST access via a token. Fire-and-forget
 * so auditing never blocks or fails a response.
 */
@Injectable()
export class TokenCallAuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method?: string;
      url?: string;
      routerPath?: string;
      headers: Record<string, string | undefined>;
      ip?: string;
      authSource?: string;
      apiTokenId?: string;
      user?: { sub?: string; activeOrgId?: string | null };
    }>();

    if (req.authSource !== 'api-token') return next.handle();

    const method = req.method ?? 'GET';
    const route = req.routerPath ?? (req.url ?? '').split('?')[0];
    const path = (req.url ?? '').split('?')[0];
    const res = context.switchToHttp().getResponse<{ statusCode?: number }>();
    const meta = {
      orgId: req.user?.activeOrgId ?? null,
      ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      source: 'api-token',
      apiTokenId: req.apiTokenId ?? null,
    };
    const write = (status: number) => {
      void this.audit
        .log(req.user?.sub ?? null, 'API_CALL', `${method} ${route}`, path, undefined, { status }, meta)
        .catch(() => undefined);
    };

    return next.handle().pipe(
      tap({
        next: () => write(res.statusCode ?? 200),
        error: (err: { status?: number }) => write(err?.status ?? 500),
      }),
    );
  }
}
