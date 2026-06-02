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
  /** Modules in the project (not soft-deleted). */
  moduleCount: number;
  /** Features across all modules (not soft-deleted). */
  featureCount: number;
  /** Features that still have untested test cases (outstanding > 0). */
  featuresOutstanding: number;
  /** Features where EVERY test case passed (total > 0 && passed === total). */
  featuresFullyPassed: number;
}

const TERMINAL_STATUSES: RunStatus[] = [
  RunStatus.PASSED,
  RunStatus.FAILED,
  RunStatus.CANCELLED,
  RunStatus.TIMED_OUT,
  RunStatus.ERROR,
];

// "Skipped" means QA explicitly hit the Skip action on the test. The
// markTestRunStatus path writes TestRun.status=CANCELLED AND flips
// pending/running RunSteps to SKIPPED. So the fingerprint for a real
// skip is: status=CANCELLED *and* at least one RunStep with status=SKIPPED.
//
// Other CANCELLED cases (whole run cancelled mid-flight) plus TIMED_OUT
// and ERROR are NOT skips — they're outstanding (no verdict, needs
// retest). Counting them as skipped silently inflated the dashboard.

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
    // optionally scoped to a specific environment. Pull a single SKIPPED
    // step as a fingerprint of an explicit QA skip (vs a run that was
    // cancelled or errored without a verdict).
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
        steps: {
          where: { status: 'SKIPPED' },
          take: 1,
          select: { id: true },
        },
      },
    });

    // Deduplicate: keep only the latest run per testDefinitionId
    const latestByTest = new Map<string, { status: RunStatus; completedAt: Date | null; hasSkippedStep: boolean }>();
    for (const run of latestRuns) {
      if (!latestByTest.has(run.testDefinitionId)) {
        latestByTest.set(run.testDefinitionId, {
          status: run.status,
          completedAt: run.completedAt,
          hasSkippedStep: run.steps.length > 0,
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
      } else if (run.status === RunStatus.CANCELLED && run.hasSkippedStep) {
        skipped++;
      } else {
        // CANCELLED-without-skip-fingerprint, TIMED_OUT, ERROR
        // — no verdict, needs retest
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
    // Walk the project's features once: aggregate for the test-level numbers
    // AND derive the module/feature counts + "features needing testing" in the
    // same pass (cheaper than a second traversal).
    const [moduleCount, features] = await Promise.all([
      this.prisma.module.count({ where: { projectId, deletedAt: null } }),
      this.prisma.feature.findMany({
        where: { deletedAt: null, module: { projectId, deletedAt: null } },
        select: { id: true },
      }),
    ]);

    const featureStatsList = await Promise.all(
      features.map((f) => this.computeFeatureStats(f.id, envId)),
    );

    const aggregated = this.aggregateStats(featureStatsList);
    // A feature "still needs testing" when it has at least one untested case.
    const featuresOutstanding = featureStatsList.filter((s) => s.outstanding > 0).length;
    // "Fully tested + passed" = the feature has test cases AND every one passed.
    const featuresFullyPassed = featureStatsList.filter((s) => s.total > 0 && s.passed === s.total).length;

    return {
      projectId,
      ...aggregated,
      moduleCount,
      featureCount: features.length,
      featuresOutstanding,
      featuresFullyPassed,
    };
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
