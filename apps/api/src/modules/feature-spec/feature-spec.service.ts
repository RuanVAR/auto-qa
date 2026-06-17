import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseSpec, serializeSpec, specFromTests, DslError, type Step } from '@qa-platform/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface SpecSyncResult {
  describe: string;
  created: number;
  updated: number;
  deleted: number;
}

/**
 * Feature "Spec" authoring — a feature-level describe/it document that maps to
 * the feature's TestDefinitions. The DSL parser/serializer lives in
 * @qa-platform/shared (single source of truth); this service is the diff-and-
 * sync layer between the text and the TestDefinition rows.
 */
@Injectable()
export class FeatureSpecService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadFeature(featureId: string) {
    const feature = await this.prisma.feature.findFirst({
      where: { id: featureId, deletedAt: null },
      select: { id: true, name: true, module: { select: { projectId: true } } },
    });
    if (!feature) throw new NotFoundException('Feature not found');
    return feature;
  }

  /** Serialize the feature's active TestDefinitions to spec text. */
  async getSpec(featureId: string): Promise<{ describe: string; text: string }> {
    const feature = await this.loadFeature(featureId);
    const tests = await this.prisma.testDefinition.findMany({
      where: { featureId, deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, steps: true },
    });
    const spec = specFromTests(
      feature.name,
      tests.map((t) => ({
        id: t.id,
        name: t.name,
        steps: (Array.isArray(t.steps) ? t.steps : []) as unknown as Step[],
      })),
    );
    return { describe: feature.name, text: serializeSpec(spec) };
  }

  /** Validate spec text without persisting. */
  validate(text: string): { ok: boolean; error?: string; line?: number } {
    try {
      parseSpec(text);
      return { ok: true };
    } catch (err) {
      if (err instanceof DslError) return { ok: false, error: err.message, line: err.line };
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Parse spec text and reconcile the feature's TestDefinitions to match:
   * - `it` with a known #id → update that test's name + steps
   * - `it` with no id but a name match → adopt + update that test
   * - new `it` → create a TestDefinition
   * - existing test absent from the spec → soft-delete
   */
  async syncSpec(featureId: string, text: string, _userId?: string): Promise<SpecSyncResult> {
    const feature = await this.loadFeature(featureId);
    let spec;
    try {
      spec = parseSpec(text);
    } catch (err) {
      if (err instanceof DslError) throw new BadRequestException(err.message);
      throw new BadRequestException((err as Error).message);
    }

    const existing = await this.prisma.testDefinition.findMany({
      where: { featureId, deletedAt: null, isActive: true },
      select: { id: true, name: true },
    });
    const byId = new Map(existing.map((t) => [t.id, t]));
    const matched = new Set<string>();
    let created = 0;
    let updated = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const test of spec.tests) {
        const steps = test.steps as unknown as Prisma.InputJsonValue;
        // 1. id match
        let targetId: string | undefined;
        if (test.id && byId.has(test.id) && !matched.has(test.id)) {
          targetId = test.id;
        } else {
          // 2. name match among unmatched
          const nameHit = existing.find(
            (e) => !matched.has(e.id) && e.name.toLowerCase() === test.name.toLowerCase(),
          );
          if (nameHit) targetId = nameHit.id;
        }

        if (targetId) {
          matched.add(targetId);
          await tx.testDefinition.update({
            where: { id: targetId },
            data: { name: test.name, steps, version: { increment: 1 } },
          });
          updated++;
        } else {
          await tx.testDefinition.create({
            data: {
              projectId: feature.module.projectId,
              featureId,
              name: test.name,
              type: 'UI',
              steps,
            },
          });
          created++;
        }
      }

      // 3. soft-delete tests not present in the spec
      const toDelete = existing.filter((e) => !matched.has(e.id));
      if (toDelete.length > 0) {
        await tx.testDefinition.updateMany({
          where: { id: { in: toDelete.map((t) => t.id) } },
          data: { deletedAt: new Date(), isActive: false },
        });
      }
    });

    const deleted = existing.length - matched.size;
    return { describe: spec.describe, created, updated, deleted };
  }
}
