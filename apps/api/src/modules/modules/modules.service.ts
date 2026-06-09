import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ImportExportService } from '../import-export/import-export.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { clampLimit } from '../../common/util/pagination';

@Injectable()
export class ModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importExport: ImportExportService,
  ) {}

  findByProject(projectId: string) {
    return this.prisma.module.findMany({
      where: { projectId, deletedAt: null },
      include: { _count: { select: { features: true } } },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(id: string) {
    const mod = await this.prisma.module.findFirst({
      where: { id, deletedAt: null },
      include: { features: { where: { deletedAt: null }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!mod) throw new NotFoundException('Module not found');
    return mod;
  }

  async create(projectId: string, dto: CreateModuleDto) {
    const envCount = await this.prisma.environment.count({
      where: { projectId, deletedAt: null },
    });
    if (envCount === 0) {
      throw new BadRequestException('Create an environment first before creating modules');
    }

    return this.prisma.module.create({
      data: {
        projectId,
        name: dto.name,
        description: dto.description,
        order: dto.order ?? 0,
        tags: dto.tags ?? [],
      },
    });
  }

  async update(id: string, dto: UpdateModuleDto) {
    const before = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      // Snapshot current state before overwriting (max 5 kept)
      await this.importExport.snapshotModule(tx, before, 'Before edit');
      return tx.module.update({ where: { id }, data: dto });
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.module.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  /**
   * Bulk soft-delete modules scoped to projectId so a leaked id from another
   * project is silently ignored rather than archived.
   */
  async bulkArchive(projectId: string, ids: string[]) {
    if (!ids?.length) return { archived: 0 };
    const res = await this.prisma.module.updateMany({
      where: { id: { in: ids }, projectId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { archived: res.count };
  }

  async getDistinctTags(projectId: string): Promise<string[]> {
    const result = await this.prisma.$queryRaw<Array<{ tag: string }>>`
      SELECT DISTINCT unnest(tags) AS tag
      FROM modules
      WHERE "projectId" = ${projectId}
        AND "deletedAt" IS NULL
      ORDER BY 1
    `;
    return result.map((r) => r.tag);
  }

  /**
   * Paginated, filterable module browser. Mirrors tests/features browse —
   * search (name/description/tags), tag (hasSome), and sort.
   */
  async browse(
    projectId: string,
    opts: {
      page?: number;
      limit?: number;
      search?: string;
      tags?: string[];
      sort?: 'order_asc' | 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc' | 'updated_desc';
    },
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = clampLimit(opts.limit, { def: 25, max: 100 });

    const where: Prisma.ModuleWhereInput = { projectId, deletedAt: null };
    if (opts.search?.trim()) {
      const s = opts.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { tags: { has: s } },
      ];
    }
    if (opts.tags?.length) where.tags = { hasSome: opts.tags };

    const orderBy: Prisma.ModuleOrderByWithRelationInput =
      opts.sort === 'name_asc' ? { name: 'asc' }
      : opts.sort === 'name_desc' ? { name: 'desc' }
      : opts.sort === 'created_desc' ? { createdAt: 'desc' }
      : opts.sort === 'created_asc' ? { createdAt: 'asc' }
      : opts.sort === 'updated_desc' ? { updatedAt: 'desc' }
      : { order: 'asc' };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.module.count({ where }),
      this.prisma.module.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { features: true } } },
      }),
    ]);

    return {
      items: rows,
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    };
  }
}
