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
