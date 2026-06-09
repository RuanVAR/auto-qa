import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';
import { clampLimit } from '../../common/util/pagination';

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  findByModule(moduleId: string) {
    return this.prisma.feature.findMany({
      where: { moduleId, deletedAt: null },
      include: {
        _count: { select: { testDefinitions: true, featureRuns: true } },
        versions: { where: { isActive: true }, take: 1, select: { id: true, label: true, name: true, versionNumber: true } },
        // The feature's own ClickUp link (issueId=null) — carries the cached
        // epic AND the cached ticket id + status so the module list can render
        // both the epic chip and the linked-ticket pill with no API call.
        ticketLinks: {
          where: { issueId: null, deletedAt: null, install: { pluginId: 'clickup' } },
          select: {
            externalId: true,
            externalUrl: true,
            externalStatus: true,
            externalStatusColor: true,
            externalEpicName: true,
            externalEpicColor: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Persist a manual ordering for a module's features. `orderedIds` is the
   *  desired top-to-bottom order; each feature's `order` is set to its index.
   *  Ids not belonging to this module are ignored. One transaction. */
  async reorder(moduleId: string, orderedIds: string[]) {
    const existing = await this.prisma.feature.findMany({
      where: { moduleId, deletedAt: null },
      select: { id: true },
    });
    const valid = new Set(existing.map((f) => f.id));
    const ordered = orderedIds.filter((id) => valid.has(id));
    await this.prisma.$transaction(
      ordered.map((id, index) =>
        this.prisma.feature.update({ where: { id }, data: { order: index } }),
      ),
    );
    return { reordered: ordered.length };
  }

  async findOne(id: string) {
    const feature = await this.prisma.feature.findFirst({
      where: { id, deletedAt: null },
      include: {
        testDefinitions: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        versions: { where: { isActive: true }, take: 1 },
        module: { select: { id: true, name: true, projectId: true } },
      },
    });
    if (!feature) throw new NotFoundException('Feature not found');
    return feature;
  }

  create(moduleId: string, dto: CreateFeatureDto) {
    return this.prisma.feature.create({
      data: { moduleId, name: dto.name, description: dto.description, order: dto.order ?? 0, tags: dto.tags ?? [] },
    });
  }

  async update(id: string, dto: UpdateFeatureDto) {
    await this.findOne(id);
    return this.prisma.feature.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.feature.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  /**
   * Bulk soft-delete features scoped to projectId (via their module) so a leaked
   * id from another project is silently ignored.
   */
  async bulkArchive(projectId: string, ids: string[]) {
    if (!ids?.length) return { archived: 0 };
    const features = await this.prisma.feature.findMany({
      where: { id: { in: ids }, deletedAt: null, module: { projectId } },
      select: { id: true },
    });
    if (!features.length) return { archived: 0 };
    const res = await this.prisma.feature.updateMany({
      where: { id: { in: features.map((f) => f.id) } },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { archived: res.count };
  }

  /**
   * Bulk move features to another module in the SAME project. Source features
   * and target module are scoped to projectId — cross-project moves are
   * impossible regardless of payload.
   */
  async bulkMove(projectId: string, featureIds: string[], targetModuleId: string) {
    if (!featureIds?.length) return { moved: 0 };
    const targetModule = await this.prisma.module.findFirst({
      where: { id: targetModuleId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!targetModule) throw new NotFoundException('Target module not found in this project');
    const features = await this.prisma.feature.findMany({
      where: { id: { in: featureIds }, deletedAt: null, module: { projectId } },
      select: { id: true },
    });
    if (!features.length) return { moved: 0 };
    const res = await this.prisma.feature.updateMany({
      where: { id: { in: features.map((f) => f.id) } },
      data: { moduleId: targetModuleId },
    });
    return { moved: res.count };
  }

  /** Returns the SHA-256 hash of the current draft test definitions */
  async getDraftStatus(id: string) {
    const feature = await this.findOne(id);
    const activeVersion = feature.versions[0] ?? null;

    if (!activeVersion) {
      return { isDraft: true, hasUnpublishedChanges: false, activeVersion: null };
    }

    const currentHash = await this.computeHash(id);
    const hasUnpublishedChanges = currentHash !== activeVersion.snapshotHash;

    return {
      isDraft: feature.isDraft,
      hasUnpublishedChanges,
      activeVersion,
      currentHash,
    };
  }

  private async computeHash(featureId: string): Promise<string> {
    const tests = await this.prisma.testDefinition.findMany({
      where: { featureId, deletedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, type: true, steps: true, config: true, tags: true },
    });

    const { createHash } = await import('crypto');
    return createHash('sha256').update(JSON.stringify(tests)).digest('hex');
  }

  /** Distinct user-editable tags across the project's features. */
  async getDistinctTags(projectId: string): Promise<string[]> {
    const result = await this.prisma.$queryRaw<Array<{ tag: string }>>`
      SELECT DISTINCT unnest(f.tags) AS tag
      FROM features f
      JOIN modules m ON m.id = f."moduleId"
      WHERE m."projectId" = ${projectId}
        AND f."deletedAt" IS NULL
      ORDER BY 1
    `;
    return result.map((r) => r.tag);
  }

  /**
   * Distinct epics linked to the project's features, sourced from TicketLink's
   * cached epic snapshot. Tracker-agnostic — any plugin that populates
   * externalEpicName via pullTicketStatus shows up here. Returns [] when no
   * tracker/epics, so the UI can hide the Epic filter facet entirely.
   */
  async getDistinctEpics(projectId: string): Promise<Array<{ name: string; color: string | null }>> {
    return this.prisma.$queryRaw<Array<{ name: string; color: string | null }>>`
      SELECT DISTINCT tl."externalEpicName" AS name, tl."externalEpicColor" AS color
      FROM ticket_links tl
      JOIN features f ON f.id = tl."featureId"
      JOIN modules m ON m.id = f."moduleId"
      WHERE m."projectId" = ${projectId}
        AND tl."externalEpicName" IS NOT NULL
        AND tl."deletedAt" IS NULL
        AND f."deletedAt" IS NULL
      ORDER BY 1
    `;
  }

  /**
   * Paginated, filterable feature browser for the whole project. Mirrors
   * tests.service.browse — search (name/description/tags), module, tag
   * (hasSome), epic (via linked TicketLink), and sort.
   */
  async browse(
    projectId: string,
    opts: {
      page?: number;
      limit?: number;
      search?: string;
      moduleId?: string;
      tags?: string[];
      epics?: string[];
      sort?: 'updated_desc' | 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc';
    },
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = clampLimit(opts.limit, { def: 25, max: 100 });

    const where: Prisma.FeatureWhereInput = {
      deletedAt: null,
      module: { projectId, deletedAt: null },
    };
    if (opts.search?.trim()) {
      const s = opts.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { tags: { has: s } },
      ];
    }
    if (opts.moduleId) where.moduleId = opts.moduleId;
    if (opts.tags?.length) where.tags = { hasSome: opts.tags };
    if (opts.epics?.length) {
      where.ticketLinks = {
        some: { deletedAt: null, externalEpicName: { in: opts.epics } },
      };
    }

    const orderBy: Prisma.FeatureOrderByWithRelationInput =
      opts.sort === 'name_asc' ? { name: 'asc' }
      : opts.sort === 'name_desc' ? { name: 'desc' }
      : opts.sort === 'created_desc' ? { createdAt: 'desc' }
      : opts.sort === 'created_asc' ? { createdAt: 'asc' }
      : { updatedAt: 'desc' };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.feature.count({ where }),
      this.prisma.feature.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          tags: true,
          updatedAt: true,
          moduleId: true,
          module: { select: { id: true, name: true } },
          _count: { select: { testDefinitions: true } },
          ticketLinks: {
            where: { issueId: null, deletedAt: null, externalEpicName: { not: null } },
            select: { externalEpicName: true, externalEpicColor: true },
            take: 1,
          },
        },
      }),
    ]);

    return {
      items: rows.map((f) => ({
        id: f.id,
        name: f.name,
        tags: f.tags,
        updatedAt: f.updatedAt,
        moduleId: f.moduleId,
        moduleName: f.module?.name ?? null,
        testCount: f._count.testDefinitions,
        epicName: f.ticketLinks[0]?.externalEpicName ?? null,
        epicColor: f.ticketLinks[0]?.externalEpicColor ?? null,
      })),
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    };
  }
}
