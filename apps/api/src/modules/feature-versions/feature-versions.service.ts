import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';

export class PublishVersionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

@Injectable()
export class FeatureVersionsService {
  constructor(private readonly prisma: PrismaService) {}

  findByFeature(featureId: string) {
    return this.prisma.featureVersion.findMany({
      where: { featureId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        _count: { select: { testRuns: true } },
      },
      orderBy: { versionNumber: 'desc' },
    });
  }

  async findOne(featureId: string, versionId: string) {
    const version = await this.prisma.featureVersion.findFirst({
      where: { id: versionId, featureId },
    });
    if (!version) throw new NotFoundException('Feature version not found');
    return version;
  }

  async publish(featureId: string, dto: PublishVersionDto, userId: string) {
    // Get current test definitions for this feature
    const tests = await this.prisma.testDefinition.findMany({
      where: { featureId, deletedAt: null },
      orderBy: { id: 'asc' },
    });

    if (tests.length === 0) {
      throw new BadRequestException('Cannot publish a feature with no test definitions');
    }

    // Build snapshot
    const snapshot = {
      schemaVersion: 1,
      featureId,
      capturedAt: new Date().toISOString(),
      testDefinitions: tests.map(t => ({
        id: t.id,
        name: t.name,
        type: t.type,
        description: t.description,
        tags: t.tags,
        steps: t.steps,
        config: t.config,
        version: t.version,
      })),
    };

    // Hash uses only stable, user-editable fields (same set as FeaturesService.computeHash)
    const hashInput = tests.map(t => ({ id: t.id, name: t.name, type: t.type, steps: t.steps, config: t.config, tags: t.tags }));
    const snapshotHash = createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');

    // Determine next version number
    const lastVersion = await this.prisma.featureVersion.findFirst({
      where: { featureId },
      orderBy: { versionNumber: 'desc' },
    });
    const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;
    const label = `v${versionNumber}.0`;

    // Deactivate previous active version
    await this.prisma.featureVersion.updateMany({
      where: { featureId, isActive: true },
      data: { isActive: false },
    });

    // Create new version
    const version = await this.prisma.featureVersion.create({
      data: {
        featureId,
        versionNumber,
        label,
        name: dto.name,
        description: dto.description,
        snapshot: snapshot as Prisma.InputJsonValue,
        snapshotHash,
        isActive: true,
        createdById: userId,
      },
    });

    // Update feature: mark as published
    await this.prisma.feature.update({
      where: { id: featureId },
      data: { isDraft: false, activeVersionId: version.id },
    });

    return version;
  }

  async restore(featureId: string, versionId: string) {
    const version = await this.findOne(featureId, versionId);
    const snapshot = version.snapshot as {
      testDefinitions: Array<{
        id: string; name: string; type: string; description: string | null;
        tags: string[]; steps: unknown; config: unknown; version: number;
      }>;
    };

    if (!snapshot?.testDefinitions) {
      throw new BadRequestException('Version snapshot is corrupted');
    }

    // Soft-delete all existing test definitions for this feature
    await this.prisma.testDefinition.updateMany({
      where: { featureId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    // Re-create from snapshot
    for (const td of snapshot.testDefinitions) {
      await this.prisma.testDefinition.create({
        data: {
          name: td.name,
          type: td.type as Prisma.EnumTestCaseTypeFilter['equals'],
          description: td.description,
          tags: td.tags,
          steps: td.steps as Prisma.InputJsonValue,
          config: (td.config as Prisma.InputJsonValue) ?? Prisma.DbNull,
          featureId,
          projectId: (await this.prisma.feature.findUnique({
            where: { id: featureId },
            include: { module: true },
          }))!.module.projectId,
        },
      });
    }

    // Mark feature as having a draft again
    await this.prisma.feature.update({ where: { id: featureId }, data: { isDraft: true } });

    return { restored: snapshot.testDefinitions.length };
  }

  async diff(featureId: string, versionAId: string, versionBId: string) {
    const [vA, vB] = await Promise.all([
      this.findOne(featureId, versionAId),
      this.findOne(featureId, versionBId),
    ]);

    const snapshotA = (vA.snapshot as { testDefinitions: Array<{ id: string; name: string }> }).testDefinitions ?? [];
    const snapshotB = (vB.snapshot as { testDefinitions: Array<{ id: string; name: string }> }).testDefinitions ?? [];

    const mapA = new Map(snapshotA.map(t => [t.id, t]));
    const mapB = new Map(snapshotB.map(t => [t.id, t]));

    const added = snapshotB.filter(t => !mapA.has(t.id));
    const removed = snapshotA.filter(t => !mapB.has(t.id));
    const modified = snapshotB.filter(t => {
      const orig = mapA.get(t.id);
      return orig && JSON.stringify(orig) !== JSON.stringify(t);
    });

    return { added, removed, modified, fromVersion: vA.label, toVersion: vB.label };
  }

  async setActive(featureId: string, versionId: string) {
    await this.findOne(featureId, versionId);
    await this.prisma.featureVersion.updateMany({
      where: { featureId, isActive: true },
      data: { isActive: false },
    });
    const version = await this.prisma.featureVersion.update({
      where: { id: versionId },
      data: { isActive: true },
    });
    await this.prisma.feature.update({ where: { id: featureId }, data: { activeVersionId: versionId } });
    return version;
  }
}
