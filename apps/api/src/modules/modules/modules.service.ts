import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ImportExportService } from '../import-export/import-export.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';

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
    return this.prisma.module.update({ where: { id }, data: { deletedAt: new Date() } });
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
}
