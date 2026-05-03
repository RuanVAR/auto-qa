import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  findByModule(moduleId: string) {
    return this.prisma.feature.findMany({
      where: { moduleId, deletedAt: null },
      include: {
        _count: { select: { testDefinitions: true, featureRuns: true } },
        versions: { where: { isActive: true }, take: 1, select: { id: true, label: true, name: true, versionNumber: true } },
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
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
      data: { moduleId, name: dto.name, description: dto.description, order: dto.order ?? 0 },
    });
  }

  async update(id: string, dto: UpdateFeatureDto) {
    await this.findOne(id);
    return this.prisma.feature.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.feature.update({ where: { id }, data: { deletedAt: new Date() } });
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
}
