import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RunStatus } from '@prisma/client';

export interface StatsBase {
  passed: number;
  failed: number;
  skipped: number;
  outstanding: number;
  total: number;
  passRate: number | null;
  lastRunAt: string | null;
}

export interface FeatureStats extends StatsBase {
  featureId: string;
}

export interface ModuleStats extends StatsBase {
  moduleId: string;
}

export interface ProjectStats extends StatsBase {
  projectId: string;
}

const TERMINAL_STATUSES: RunStatus[] = [
  RunStatus.PASSED,
  RunStatus.FAILED,
  RunStatus.CANCELLED,
  RunStatus.TIMED_OUT,
  RunStatus.ERROR,
];

// SKIPPED/ABORTED in spec → map to CANCELLED/TIMED_OUT/ERROR in RunStatus
const SKIPPED_STATUSES: RunStatus[] = [
  RunStatus.CANCELLED,
  RunStatus.TIMED_OUT,
  RunStatus.ERROR,
];

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async computeFeatureStats(featureId: string, envId?: string | null): Promise<FeatureStats> {
    // Load all active test definitions for this feature
    const testDefs = await this.prisma.testDefinition.findMany({
      where: { featureId, deletedAt: null },
      select: { id: true },
    });

    if (testDefs.length === 0) {
      return {
        featureId,
        passed: 0,
        failed: 0,
        skipped: 0,
        outstanding: 0,
        total: 0,
        passRate: null,
        lastRunAt: null,
      };
    }

    const testDefIds = testDefs.map((t) => t.id);

    // For each test definition, find the most recent terminal run
    // optionally scoped to a specific environment
    const latestRuns = await this.prisma.testRun.findMany({
      where: {
        testDefinitionId: { in: testDefIds },
        status: { in: TERMINAL_STATUSES },
        ...(envId ? { environmentId: envId } : {}),
      },
      orderBy: { completedAt: 'desc' },
      select: {
        testDefinitionId: true,
        status: true,
        completedAt: true,
      },
    });

    // Deduplicate: keep only the latest run per testDefinitionId
    const latestByTest = new Map<string, { status: RunStatus; completedAt: Date | null }>();
    for (const run of latestRuns) {
      if (!latestByTest.has(run.testDefinitionId)) {
        latestByTest.set(run.testDefinitionId, {
          status: run.status,
          completedAt: run.completedAt,
        });
      }
    }

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let outstanding = 0;
    let lastRunAt: Date | null = null;

    for (const defId of testDefIds) {
      const run = latestByTest.get(defId);
      if (!run) {
        outstanding++;
        continue;
      }

      if (run.status === RunStatus.PASSED) {
        passed++;
      } else if (run.status === RunStatus.FAILED) {
        failed++;
      } else if (SKIPPED_STATUSES.includes(run.status)) {
        skipped++;
      } else {
        outstanding++;
      }

      if (run.completedAt) {
        if (!lastRunAt || run.completedAt > lastRunAt) {
          lastRunAt = run.completedAt;
        }
      }
    }

    const total = testDefs.length;
    const denominator = passed + failed;
    const passRate = denominator === 0 ? null : Math.round((passed / denominator) * 100);

    return {
      featureId,
      passed,
      failed,
      skipped,
      outstanding,
      total,
      passRate,
      lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    };
  }

  async computeModuleStats(moduleId: string, envId?: string | null): Promise<ModuleStats> {
    const features = await this.prisma.feature.findMany({
      where: { moduleId, deletedAt: null },
      select: { id: true },
    });

    const featureStatsList = await Promise.all(
      features.map((f) => this.computeFeatureStats(f.id, envId)),
    );

    const aggregated = this.aggregateStats(featureStatsList);

    return { moduleId, ...aggregated };
  }

  async computeModuleStatsForProject(projectId: string, envId?: string | null): Promise<ModuleStats[]> {
    const modules = await this.prisma.module.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true },
    });

    return Promise.all(modules.map((m) => this.computeModuleStats(m.id, envId)));
  }

  async computeProjectStats(projectId: string, envId?: string | null): Promise<ProjectStats> {
    const moduleStatsList = await this.computeModuleStatsForProject(projectId, envId);

    const aggregated = this.aggregateStats(moduleStatsList);

    return { projectId, ...aggregated };
  }

  async computeFeatureStatsForModule(moduleId: string, envId?: string | null): Promise<FeatureStats[]> {
    const features = await this.prisma.feature.findMany({
      where: { moduleId, deletedAt: null },
      select: { id: true },
    });

    return Promise.all(features.map((f) => this.computeFeatureStats(f.id, envId)));
  }

  private aggregateStats(list: StatsBase[]): StatsBase {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let outstanding = 0;
    let total = 0;
    let lastRunAt: string | null = null;

    for (const s of list) {
      passed += s.passed;
      failed += s.failed;
      skipped += s.skipped;
      outstanding += s.outstanding;
      total += s.total;

      if (s.lastRunAt) {
        if (!lastRunAt || s.lastRunAt > lastRunAt) {
          lastRunAt = s.lastRunAt;
        }
      }
    }

    const denominator = passed + failed;
    const passRate = denominator === 0 ? null : Math.round((passed / denominator) * 100);

    return { passed, failed, skipped, outstanding, total, passRate, lastRunAt };
  }
}
