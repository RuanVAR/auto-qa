import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '@prisma/client';

const EXPORT_VERSION = '1.0';
const PLATFORM_VERSION = '0.1.0';
const MAX_SNAPSHOTS = 5;

// ─── Portable types (no DB ids, no org-specific data) ────────────────────────

export interface ExportTestCase {
  name: string;
  description?: string | null;
  type: string;
  tags: string[];
  steps: unknown;
  config?: unknown;
}

export interface ExportFeature {
  name: string;
  description?: string | null;
  order: number;
  testCases: ExportTestCase[];
}

export interface ExportModule {
  name: string;
  description?: string | null;
  order: number;
  tags: string[];
  features: ExportFeature[];
}

export interface ExportProject {
  name: string;
  slug: string;
  description?: string | null;
  modules: ExportModule[];
}

export interface ExportEnvelope {
  version: string;
  exportType: 'project' | 'module' | 'feature' | 'testCase';
  exportedAt: string;
  platformVersion: string;
  project?: ExportProject;
  module?: ExportModule;
  feature?: ExportFeature;
  testCase?: ExportTestCase;
}

// ─── Conflict info ─────────────────────────────────────────────────────────

export interface ConflictItem {
  type: 'module' | 'feature' | 'testCase';
  originalName: string;
  resolvedName: string;
}

// ─── Import result ─────────────────────────────────────────────────────────

export interface ImportSummary {
  modulesCreated: number;
  featuresCreated: number;
  testCasesCreated: number;
  conflicts: ConflictItem[];
}

// ─── Preview result ────────────────────────────────────────────────────────

export interface PreviewResult {
  valid: boolean;
  error?: string;
  exportType: string;
  exportedAt: string;
  sourceName: string;
  modulesCount: number;
  featuresCount: number;
  testCasesCount: number;
  conflicts: ConflictItem[];
  /**
   * Tree of items the import will touch, with stable selection paths.
   * Path format mirrors the envelope shape:
   *   "module:0"
   *   "module:0/feature:1"
   *   "module:0/feature:1/test:2"
   *   "feature:0"           (module-less feature import)
   *   "test:0"              (test-case import)
   *
   * Frontend renders this as a checkbox tree; on confirm it sends back the
   * set of selected paths so the importer can skip unselected branches.
   */
  items: PreviewItem[];
}

export interface PreviewItem {
  path: string;
  kind: 'module' | 'feature' | 'test';
  name: string;
  children?: PreviewItem[];
  /** Already exists in the destination — will be deduped on import (skip). */
  conflict?: boolean;
}

@Injectable()
export class ImportExportService {
  constructor(private readonly prisma: PrismaService) {}

  // ── EXPORT ─────────────────────────────────────────────────────────────────

  async exportProject(projectId: string): Promise<ExportEnvelope> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      include: {
        modules: {
          where: { deletedAt: null },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          include: {
            features: {
              where: { deletedAt: null },
              orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
              include: {
                testDefinitions: {
                  where: { deletedAt: null },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!project) throw new NotFoundException('Project not found');

    return {
      version: EXPORT_VERSION,
      exportType: 'project',
      exportedAt: new Date().toISOString(),
      platformVersion: PLATFORM_VERSION,
      project: {
        name: project.name,
        slug: project.slug,
        description: project.description,
        modules: project.modules.map((m) => this.serializeModule(m)),
      },
    };
  }

  async exportModule(moduleId: string): Promise<ExportEnvelope> {
    const mod = await this.prisma.module.findFirst({
      where: { id: moduleId, deletedAt: null },
      include: {
        features: {
          where: { deletedAt: null },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          include: {
            testDefinitions: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    if (!mod) throw new NotFoundException('Module not found');

    return {
      version: EXPORT_VERSION,
      exportType: 'module',
      exportedAt: new Date().toISOString(),
      platformVersion: PLATFORM_VERSION,
      module: this.serializeModule(mod),
    };
  }

  async exportFeature(featureId: string): Promise<ExportEnvelope> {
    const feature = await this.prisma.feature.findFirst({
      where: { id: featureId, deletedAt: null },
      include: {
        testDefinitions: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!feature) throw new NotFoundException('Feature not found');

    return {
      version: EXPORT_VERSION,
      exportType: 'feature',
      exportedAt: new Date().toISOString(),
      platformVersion: PLATFORM_VERSION,
      feature: this.serializeFeature(feature),
    };
  }

  async exportTestCase(testId: string): Promise<ExportEnvelope> {
    const test = await this.prisma.testDefinition.findFirst({
      where: { id: testId, deletedAt: null },
    });

    if (!test) throw new NotFoundException('Test not found');

    return {
      version: EXPORT_VERSION,
      exportType: 'testCase',
      exportedAt: new Date().toISOString(),
      platformVersion: PLATFORM_VERSION,
      testCase: this.serializeTestCase(test),
    };
  }

  // ── PREVIEW ────────────────────────────────────────────────────────────────

  async previewImport(
    projectId: string,
    envelope: ExportEnvelope,
    opts: { targetModuleId?: string; targetFeatureId?: string } = {},
  ): Promise<PreviewResult> {
    if (!envelope.version?.startsWith('1.')) {
      return {
        valid: false,
        error: `Incompatible export version: ${envelope.version}. Requires 1.x`,
        exportType: envelope.exportType ?? 'unknown',
        exportedAt: envelope.exportedAt ?? '',
        sourceName: '',
        modulesCount: 0,
        featuresCount: 0,
        testCasesCount: 0,
        conflicts: [],
        items: [],
      };
    }

    let sourceName = '';
    let modulesCount = 0;
    let featuresCount = 0;
    let testCasesCount = 0;
    const conflicts: ConflictItem[] = [];
    const items: PreviewItem[] = [];

    switch (envelope.exportType) {
      case 'project':
        sourceName = envelope.project?.name ?? '';
        for (let mi = 0; mi < (envelope.project?.modules?.length ?? 0); mi++) {
          const m = envelope.project!.modules![mi];
          modulesCount++;
          const resolvedModule = await this.resolvedModuleName(projectId, m.name);
          const moduleConflict = resolvedModule !== m.name;
          if (moduleConflict) conflicts.push({ type: 'module', originalName: m.name, resolvedName: resolvedModule });

          const featureItems: PreviewItem[] = [];
          for (let fi = 0; fi < (m.features?.length ?? 0); fi++) {
            const f = m.features![fi];
            featuresCount++;
            const testItems: PreviewItem[] = [];
            for (let ti = 0; ti < (f.testCases?.length ?? 0); ti++) {
              const tc = f.testCases![ti];
              testCasesCount++;
              testItems.push({ path: `module:${mi}/feature:${fi}/test:${ti}`, kind: 'test', name: tc.name });
            }
            featureItems.push({ path: `module:${mi}/feature:${fi}`, kind: 'feature', name: f.name, children: testItems });
          }
          items.push({ path: `module:${mi}`, kind: 'module', name: m.name, conflict: moduleConflict, children: featureItems });
        }
        break;

      case 'module': {
        sourceName = envelope.module?.name ?? '';
        modulesCount = 1;
        const resolvedMod = await this.resolvedModuleName(projectId, envelope.module?.name ?? '');
        const moduleConflict = resolvedMod !== (envelope.module?.name ?? '');
        if (moduleConflict) {
          conflicts.push({ type: 'module', originalName: envelope.module?.name ?? '', resolvedName: resolvedMod });
        }
        const featureItems: PreviewItem[] = [];
        for (let fi = 0; fi < (envelope.module?.features?.length ?? 0); fi++) {
          const f = envelope.module!.features![fi];
          featuresCount++;
          const testItems: PreviewItem[] = [];
          for (let ti = 0; ti < (f.testCases?.length ?? 0); ti++) {
            testCasesCount++;
            testItems.push({ path: `module:0/feature:${fi}/test:${ti}`, kind: 'test', name: f.testCases![ti].name });
          }
          featureItems.push({ path: `module:0/feature:${fi}`, kind: 'feature', name: f.name, children: testItems });
        }
        items.push({ path: 'module:0', kind: 'module', name: envelope.module?.name ?? '', conflict: moduleConflict, children: featureItems });
        break;
      }

      case 'feature': {
        sourceName = envelope.feature?.name ?? '';
        featuresCount = 1;
        let featureConflict = false;
        if (opts.targetModuleId) {
          const resolvedFeature = await this.resolvedFeatureName(opts.targetModuleId, envelope.feature?.name ?? '');
          featureConflict = resolvedFeature !== (envelope.feature?.name ?? '');
          if (featureConflict) conflicts.push({ type: 'feature', originalName: envelope.feature?.name ?? '', resolvedName: resolvedFeature });
        }
        const testItems: PreviewItem[] = [];
        for (let ti = 0; ti < (envelope.feature?.testCases?.length ?? 0); ti++) {
          testCasesCount++;
          testItems.push({ path: `feature:0/test:${ti}`, kind: 'test', name: envelope.feature!.testCases![ti].name });
        }
        items.push({ path: 'feature:0', kind: 'feature', name: envelope.feature?.name ?? '', conflict: featureConflict, children: testItems });
        break;
      }

      case 'testCase':
        sourceName = envelope.testCase?.name ?? '';
        testCasesCount = 1;
        if (opts.targetFeatureId) {
          const resolvedTc = await this.resolvedTestCaseName(opts.targetFeatureId, envelope.testCase?.name ?? '');
          const conflict = resolvedTc !== (envelope.testCase?.name ?? '');
          if (conflict) conflicts.push({ type: 'testCase', originalName: envelope.testCase?.name ?? '', resolvedName: resolvedTc });
          items.push({ path: 'test:0', kind: 'test', name: envelope.testCase?.name ?? '', conflict });
        } else {
          items.push({ path: 'test:0', kind: 'test', name: envelope.testCase?.name ?? '' });
        }
        break;
    }

    return {
      valid: true,
      exportType: envelope.exportType,
      exportedAt: envelope.exportedAt,
      sourceName,
      modulesCount,
      featuresCount,
      testCasesCount,
      conflicts,
      items,
    };
  }

  // ── FEATURE IMPORT (convenience — looks up projectId from the module) ─────

  async importFeatureIntoModule(
    moduleId: string,
    envelope: ExportEnvelope,
    importedById?: string,
  ): Promise<ImportSummary> {
    if (envelope.exportType !== 'feature') {
      throw new BadRequestException(
        `This endpoint only accepts feature exports. Got: ${envelope.exportType}`,
      );
    }
    if (!envelope.feature) {
      throw new BadRequestException('Missing feature data in envelope');
    }

    const mod = await this.prisma.module.findFirst({
      where: { id: moduleId, deletedAt: null },
    });
    if (!mod) throw new NotFoundException('Target module not found');

    return this.importIntoProject(mod.projectId, envelope, {
      targetModuleId: moduleId,
      importedById,
    });
  }

  // ── IMPORT ─────────────────────────────────────────────────────────────────

  async importIntoProject(
    projectId: string,
    envelope: ExportEnvelope,
    opts: { targetModuleId?: string; targetFeatureId?: string; importedById?: string; selection?: string[] } = {},
  ): Promise<ImportSummary> {
    if (!envelope.version?.startsWith('1.')) {
      throw new BadRequestException(
        `Incompatible export version: ${envelope.version}. This platform supports version 1.x only.`,
      );
    }

    // Apply user's selection filter — drop modules/features/tests whose
    // path isn't in the selection set. Empty / undefined selection = import
    // everything (back-compat).
    if (opts.selection && opts.selection.length > 0) {
      envelope = this.filterEnvelopeBySelection(envelope, new Set(opts.selection));
    }

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Project not found');

    const summary: ImportSummary = {
      modulesCreated: 0,
      featuresCreated: 0,
      testCasesCreated: 0,
      conflicts: [],
    };

    await this.prisma.$transaction(async (tx) => {
      switch (envelope.exportType) {
        case 'project':
          if (!envelope.project) throw new BadRequestException('Missing project data in envelope');
          for (const mod of envelope.project.modules) {
            await this.createModule(tx, projectId, mod, summary);
          }
          break;

        case 'module':
          if (!envelope.module) throw new BadRequestException('Missing module data in envelope');
          await this.createModule(tx, projectId, envelope.module, summary);
          break;

        case 'feature': {
          if (!envelope.feature) throw new BadRequestException('Missing feature data in envelope');
          const moduleId = opts.targetModuleId;
          if (!moduleId) throw new BadRequestException('targetModuleId is required when importing a feature');
          await this.createFeature(tx, projectId, moduleId, envelope.feature, summary);
          break;
        }

        case 'testCase': {
          if (!envelope.testCase) throw new BadRequestException('Missing testCase data in envelope');
          const featureId = opts.targetFeatureId;
          if (!featureId) throw new BadRequestException('targetFeatureId is required when importing a test case');
          const feature = await tx.feature.findFirst({ where: { id: featureId, deletedAt: null } });
          if (!feature) throw new NotFoundException('Target feature not found');
          await this.createTestCase(tx, projectId, featureId, envelope.testCase, summary);
          break;
        }

        default:
          throw new BadRequestException(`Unknown exportType: ${(envelope as ExportEnvelope).exportType}`);
      }

      // Write ImportLog inside transaction so it rolls back on failure
      await tx.importLog.create({
        data: {
          projectId,
          exportType: envelope.exportType,
          sourceName: this.getSourceName(envelope),
          summary: {
            modulesCreated: summary.modulesCreated,
            featuresCreated: summary.featuresCreated,
            testCasesCreated: summary.testCasesCreated,
          } as unknown as Prisma.InputJsonValue,
          conflicts: summary.conflicts as unknown as Prisma.InputJsonValue,
          importedById: opts.importedById ?? null,
        },
      });
    });

    return summary;
  }

  // ── IMPORT LOG ─────────────────────────────────────────────────────────────

  async listImportLogs(projectId: string) {
    return this.prisma.importLog.findMany({
      where: { projectId },
      orderBy: { importedAt: 'desc' },
      take: 50,
      include: {
        importedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  // ── TEST DEFINITION VERSIONS ───────────────────────────────────────────────

  async listTestVersions(testId: string) {
    return this.prisma.testDefinitionVersion.findMany({
      where: { testDefinitionId: testId },
      orderBy: { versionNumber: 'desc' },
    });
  }

  async restoreTestVersion(testId: string, versionId: string) {
    const ver = await this.prisma.testDefinitionVersion.findFirst({
      where: { id: versionId, testDefinitionId: testId },
    });
    if (!ver) throw new NotFoundException('Version not found');

    const snap = ver.snapshot as {
      name: string;
      description?: string;
      type: string;
      tags: string[];
      steps: unknown;
      config?: unknown;
    };

    // Snapshot current state before restoring
    const current = await this.prisma.testDefinition.findFirst({
      where: { id: testId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('Test definition not found');

    await this.prisma.$transaction(async (tx) => {
      await this.snapshotTestDefinition(tx, current, `Before restore to v${ver.versionNumber}`);
      await tx.testDefinition.update({
        where: { id: testId },
        data: {
          name: snap.name,
          description: snap.description ?? null,
          type: snap.type as 'UI' | 'API' | 'SHELL',
          tags: snap.tags,
          steps: snap.steps as Prisma.InputJsonValue,
          config: snap.config ? (snap.config as Prisma.InputJsonValue) : Prisma.DbNull,
          version: { increment: 1 },
        },
      });
    });

    return { restored: true, fromVersion: ver.versionNumber };
  }

  // ── MODULE VERSIONS ────────────────────────────────────────────────────────

  async listModuleVersions(moduleId: string) {
    return this.prisma.moduleVersion.findMany({
      where: { moduleId },
      orderBy: { versionNumber: 'desc' },
    });
  }

  async restoreModuleVersion(moduleId: string, versionId: string) {
    const ver = await this.prisma.moduleVersion.findFirst({
      where: { id: versionId, moduleId },
    });
    if (!ver) throw new NotFoundException('Version not found');

    const snap = ver.snapshot as {
      name: string;
      description?: string;
      tags: string[];
      order: number;
    };

    const current = await this.prisma.module.findFirst({
      where: { id: moduleId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('Module not found');

    await this.prisma.$transaction(async (tx) => {
      await this.snapshotModule(tx, current, `Before restore to v${ver.versionNumber}`);
      await tx.module.update({
        where: { id: moduleId },
        data: {
          name: snap.name,
          description: snap.description ?? null,
          tags: snap.tags,
          order: snap.order,
        },
      });
    });

    return { restored: true, fromVersion: ver.versionNumber };
  }

  // ── SNAPSHOT HELPERS (call before updates) ─────────────────────────────────

  async snapshotTestDefinition(
    tx: Prisma.TransactionClient,
    test: { id: string; name: string; description?: string | null; type: string; tags: string[]; steps: unknown; config?: unknown },
    label: string,
  ): Promise<void> {
    // Get current max version number
    const latest = await tx.testDefinitionVersion.findFirst({
      where: { testDefinitionId: test.id },
      orderBy: { versionNumber: 'desc' },
    });
    const nextVersion = (latest?.versionNumber ?? 0) + 1;

    await tx.testDefinitionVersion.create({
      data: {
        testDefinitionId: test.id,
        versionNumber: nextVersion,
        label,
        snapshot: {
          name: test.name,
          description: test.description,
          type: test.type,
          tags: test.tags,
          steps: test.steps,
          config: test.config ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    // Prune to MAX_SNAPSHOTS — delete oldest beyond limit
    const all = await tx.testDefinitionVersion.findMany({
      where: { testDefinitionId: test.id },
      orderBy: { versionNumber: 'asc' },
      select: { id: true },
    });
    if (all.length > MAX_SNAPSHOTS) {
      const toDelete = all.slice(0, all.length - MAX_SNAPSHOTS).map((v) => v.id);
      await tx.testDefinitionVersion.deleteMany({ where: { id: { in: toDelete } } });
    }
  }

  async snapshotModule(
    tx: Prisma.TransactionClient,
    mod: { id: string; name: string; description?: string | null; tags: string[]; order: number },
    label: string,
  ): Promise<void> {
    const latest = await tx.moduleVersion.findFirst({
      where: { moduleId: mod.id },
      orderBy: { versionNumber: 'desc' },
    });
    const nextVersion = (latest?.versionNumber ?? 0) + 1;

    await tx.moduleVersion.create({
      data: {
        moduleId: mod.id,
        versionNumber: nextVersion,
        label,
        snapshot: {
          name: mod.name,
          description: mod.description,
          tags: mod.tags,
          order: mod.order,
        } as Prisma.InputJsonValue,
      },
    });

    const all = await tx.moduleVersion.findMany({
      where: { moduleId: mod.id },
      orderBy: { versionNumber: 'asc' },
      select: { id: true },
    });
    if (all.length > MAX_SNAPSHOTS) {
      const toDelete = all.slice(0, all.length - MAX_SNAPSHOTS).map((v) => v.id);
      await tx.moduleVersion.deleteMany({ where: { id: { in: toDelete } } });
    }
  }

  // ── UNIQUE NAME HELPERS ────────────────────────────────────────────────────

  private async resolvedModuleName(projectId: string, name: string): Promise<string> {
    const existing = await this.prisma.module.findFirst({
      where: { projectId, name, deletedAt: null },
    });
    return existing ? `${name} (imported)` : name;
  }

  private async resolvedFeatureName(moduleId: string, name: string): Promise<string> {
    const existing = await this.prisma.feature.findFirst({
      where: { moduleId, name, deletedAt: null },
    });
    return existing ? `${name} (imported)` : name;
  }

  private async resolvedTestCaseName(featureId: string, name: string): Promise<string> {
    const existing = await this.prisma.testDefinition.findFirst({
      where: { featureId, name, deletedAt: null },
    });
    return existing ? `${name} (imported)` : name;
  }

  private async uniqueModuleName(tx: Prisma.TransactionClient, projectId: string, name: string): Promise<string> {
    const existing = await tx.module.findFirst({
      where: { projectId, name, deletedAt: null },
    });
    return existing ? `${name} (imported)` : name;
  }

  private async uniqueFeatureName(tx: Prisma.TransactionClient, moduleId: string, name: string): Promise<string> {
    const existing = await tx.feature.findFirst({
      where: { moduleId, name, deletedAt: null },
    });
    return existing ? `${name} (imported)` : name;
  }

  private async uniqueTestCaseName(tx: Prisma.TransactionClient, featureId: string, name: string): Promise<string> {
    const existing = await tx.testDefinition.findFirst({
      where: { featureId, name, deletedAt: null },
    });
    return existing ? `${name} (imported)` : name;
  }

  // ── CREATE HELPERS (run inside transaction) ────────────────────────────────

  private async createModule(
    tx: Prisma.TransactionClient,
    projectId: string,
    mod: ExportModule,
    summary: ImportSummary,
  ): Promise<void> {
    const resolvedName = await this.uniqueModuleName(tx, projectId, mod.name);
    if (resolvedName !== mod.name) {
      summary.conflicts.push({ type: 'module', originalName: mod.name, resolvedName });
    }

    const created = await tx.module.create({
      data: { projectId, name: resolvedName, description: mod.description, order: mod.order, tags: mod.tags },
    });
    summary.modulesCreated++;

    for (const feature of mod.features) {
      // Features under a newly-created module have no conflicts (new module = no existing features)
      await this.createFeature(tx, projectId, created.id, feature, summary);
    }
  }

  private async createFeature(
    tx: Prisma.TransactionClient,
    projectId: string,
    moduleId: string,
    feature: ExportFeature,
    summary: ImportSummary,
  ): Promise<void> {
    const resolvedName = await this.uniqueFeatureName(tx, moduleId, feature.name);
    if (resolvedName !== feature.name) {
      summary.conflicts.push({ type: 'feature', originalName: feature.name, resolvedName });
    }

    const created = await tx.feature.create({
      data: { moduleId, name: resolvedName, description: feature.description, order: feature.order },
    });
    summary.featuresCreated++;

    for (const tc of feature.testCases) {
      // Test cases under a newly-created feature have no conflicts
      await this.createTestCase(tx, projectId, created.id, tc, summary);
    }
  }

  private async createTestCase(
    tx: Prisma.TransactionClient,
    projectId: string,
    featureId: string,
    tc: ExportTestCase,
    summary: ImportSummary,
  ): Promise<void> {
    const resolvedName = await this.uniqueTestCaseName(tx, featureId, tc.name);
    if (resolvedName !== tc.name) {
      summary.conflicts.push({ type: 'testCase', originalName: tc.name, resolvedName });
    }

    await tx.testDefinition.create({
      data: {
        projectId,
        featureId,
        name: resolvedName,
        description: tc.description,
        type: tc.type as 'UI' | 'API' | 'SHELL',
        tags: tc.tags,
        // Ensure every step has an `input` object — older / AI-generated
        // exports sometimes ship with `{type, name}` and no input, which
        // crashes the visual step editor on edit.
        steps: normalizeSteps(tc.steps) as Prisma.InputJsonValue,
        config: tc.config ? (tc.config as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    summary.testCasesCreated++;
  }

  // ── SERIALIZE HELPERS ──────────────────────────────────────────────────────

  private serializeModule(mod: {
    name: string;
    description?: string | null;
    order: number;
    tags: string[];
    features: Array<{
      name: string;
      description?: string | null;
      order: number;
      testDefinitions: Array<{
        name: string;
        description?: string | null;
        type: string;
        tags: string[];
        steps: unknown;
        config?: unknown;
      }>;
    }>;
  }): ExportModule {
    return {
      name: mod.name,
      description: mod.description,
      order: mod.order,
      tags: mod.tags,
      features: mod.features.map((f) => this.serializeFeature(f)),
    };
  }

  private serializeFeature(feature: {
    name: string;
    description?: string | null;
    order: number;
    testDefinitions: Array<{
      name: string;
      description?: string | null;
      type: string;
      tags: string[];
      steps: unknown;
      config?: unknown;
    }>;
  }): ExportFeature {
    return {
      name: feature.name,
      description: feature.description,
      order: feature.order,
      testCases: feature.testDefinitions.map((t) => this.serializeTestCase(t)),
    };
  }

  private serializeTestCase(test: {
    name: string;
    description?: string | null;
    type: string;
    tags: string[];
    steps: unknown;
    config?: unknown;
  }): ExportTestCase {
    return {
      name: test.name,
      description: test.description,
      type: test.type,
      tags: test.tags,
      steps: test.steps,
      config: test.config ?? undefined,
    };
  }

  private getSourceName(envelope: ExportEnvelope): string {
    switch (envelope.exportType) {
      case 'project': return envelope.project?.name ?? '';
      case 'module':  return envelope.module?.name ?? '';
      case 'feature': return envelope.feature?.name ?? '';
      case 'testCase': return envelope.testCase?.name ?? '';
      default: return '';
    }
  }

  /**
   * Filter an envelope down to only the paths in `selection`.
   *
   * A path's presence is inclusive — if `module:0/feature:1/test:2` is
   * selected, its parent module:0 and feature:1 must also be present in
   * the resulting envelope (we keep the spine even if the parent's path
   * isn't explicitly in the set, since the user opting into a child
   * implies opting into the chain). Other siblings are dropped.
   *
   * Pure — returns a new envelope, doesn't mutate.
   */
  private filterEnvelopeBySelection(envelope: ExportEnvelope, selection: Set<string>): ExportEnvelope {
    const has = (path: string) => selection.has(path);
    const hasAnyChild = (prefix: string) => {
      for (const p of selection) if (p.startsWith(`${prefix}/`)) return true;
      return false;
    };

    if (envelope.exportType === 'project' && envelope.project) {
      const filteredModules: typeof envelope.project.modules = [];
      const modules = envelope.project.modules ?? [];
      for (let mi = 0; mi < modules.length; mi++) {
        const mPath = `module:${mi}`;
        if (!has(mPath) && !hasAnyChild(mPath)) continue;
        const m = modules[mi];
        const filteredFeatures: typeof m.features = [];
        for (let fi = 0; fi < (m.features ?? []).length; fi++) {
          const fPath = `${mPath}/feature:${fi}`;
          if (!has(fPath) && !hasAnyChild(fPath)) continue;
          const f = m.features![fi];
          const filteredTests = (f.testCases ?? []).filter(
            (_, ti) => has(`${fPath}/test:${ti}`),
          );
          filteredFeatures!.push({ ...f, testCases: filteredTests });
        }
        filteredModules.push({ ...m, features: filteredFeatures });
      }
      return { ...envelope, project: { ...envelope.project, modules: filteredModules } };
    }

    if (envelope.exportType === 'module' && envelope.module) {
      const m = envelope.module;
      const filteredFeatures: typeof m.features = [];
      for (let fi = 0; fi < (m.features ?? []).length; fi++) {
        const fPath = `module:0/feature:${fi}`;
        if (!has(fPath) && !hasAnyChild(fPath)) continue;
        const f = m.features![fi];
        const filteredTests = (f.testCases ?? []).filter((_, ti) => has(`${fPath}/test:${ti}`));
        filteredFeatures!.push({ ...f, testCases: filteredTests });
      }
      return { ...envelope, module: { ...m, features: filteredFeatures } };
    }

    if (envelope.exportType === 'feature' && envelope.feature) {
      const filteredTests = (envelope.feature.testCases ?? []).filter((_, ti) => has(`feature:0/test:${ti}`));
      return { ...envelope, feature: { ...envelope.feature, testCases: filteredTests } };
    }

    // testCase scope is single-item; selection is binary (in or out). If the
    // single test:0 isn't in selection, the import becomes a no-op.
    return envelope;
  }
}

/**
 * Normalise a test's `steps` array — guarantee every step has an `input`
 * object so the visual editor never trips on an undefined access. Older
 * exports / AI-generated bundles sometimes omit `input` for assertion-only
 * steps. Idempotent: running over already-normalised data is a no-op.
 */
function normalizeSteps(steps: unknown): unknown {
  if (!Array.isArray(steps)) return steps;
  return steps.map((s, i) => {
    if (!s || typeof s !== 'object') return s;
    const step = s as Record<string, unknown>;
    return {
      ...step,
      index: typeof step.index === 'number' ? step.index : i,
      input: step.input && typeof step.input === 'object' ? step.input : {},
    };
  });
}
