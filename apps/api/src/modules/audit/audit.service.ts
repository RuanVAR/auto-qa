import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    userId: string | undefined | null,
    action: string,
    entity: string,
    entityId: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
    // Request context — populated for token/MCP-driven actions; optional so the
    // ~16 existing call sites stay unchanged. `source` distinguishes web /
    // api-token / mcp; orgId enables the org-scoped audit viewer.
    meta?: {
      orgId?: string | null;
      ip?: string | null;
      userAgent?: string | null;
      source?: string | null;
      apiTokenId?: string | null;
    },
  ) {
    return this.prisma.auditLog.create({
      data: {
        userId: userId ?? null,
        action,
        entity,
        entityId,
        before: (before as Prisma.InputJsonValue) ?? Prisma.DbNull,
        after: (after as Prisma.InputJsonValue) ?? Prisma.DbNull,
        orgId: meta?.orgId ?? null,
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
        source: meta?.source ?? null,
        apiTokenId: meta?.apiTokenId ?? null,
      },
    });
  }

  /**
   * Org-scoped, filterable, cursor-paginated audit feed for the org-admin
   * viewer. Only rows carrying this `orgId` are visible (token/MCP/CRUD writes
   * set it going forward; legacy rows without an orgId never leak across orgs).
   */
  async findForOrg(
    orgId: string,
    opts: {
      limit?: number;
      cursor?: string;
      userId?: string;
      action?: string;
      source?: string;
      entity?: string;
      apiTokenId?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const createdAt =
      opts.from || opts.to
        ? {
            ...(opts.from ? { gte: new Date(opts.from) } : {}),
            ...(opts.to ? { lte: new Date(opts.to) } : {}),
          }
        : undefined;
    const where: Prisma.AuditLogWhereInput = {
      orgId,
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.action ? { action: opts.action } : {}),
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.entity ? { entity: opts.entity } : {}),
      ...(opts.apiTokenId ? { apiTokenId: opts.apiTokenId } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }

  findAll(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    return Promise.all([
      this.prisma.auditLog.findMany({
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count(),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }
}
