import { Injectable } from '@nestjs/common';
import { RunStatus, RunMode } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CANONICAL_RUN_FILTER } from '../../common/util/canonical-runs';

type RawMetric = { name?: unknown; value?: unknown; unit?: unknown; aggregation?: unknown };
export interface AggregatedMetric {
  name: string;
  value: number;
  unit: string | null;
  aggregation: string;
  runCount: number;
}

const TERMINAL: RunStatus[] = [RunStatus.PASSED, RunStatus.FAILED];

/**
 * Cross-run rollup of test-emitted metrics (Phase 7). Reads
 * TestRun.metadata.emittedMetrics across a project's recent runs and aggregates
 * each named metric by its declared mode (sum / avg / latest / min / max).
 */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async computeProjectMetrics(
    projectId: string,
    opts?: { envId?: string | null; runMode?: RunMode | null; sinceDays?: number },
  ): Promise<AggregatedMetric[]> {
    const since = new Date(Date.now() - (opts?.sinceDays ?? 30) * 24 * 60 * 60 * 1000);
    const runs = await this.prisma.testRun.findMany({
      where: {
        projectId,
        ...CANONICAL_RUN_FILTER,
        status: { in: TERMINAL },
        completedAt: { gte: since },
        ...(opts?.envId ? { environmentId: opts.envId } : {}),
        ...(opts?.runMode ? { runMode: opts.runMode } : {}),
      },
      select: { metadata: true, completedAt: true },
      orderBy: { completedAt: 'asc' },
    });

    // name → { values, unit, aggregation, latest }
    const acc = new Map<string, { values: number[]; unit: string | null; aggregation: string; latest: number }>();
    for (const run of runs) {
      const md = run.metadata as { emittedMetrics?: RawMetric[] } | null;
      if (!md?.emittedMetrics || !Array.isArray(md.emittedMetrics)) continue;
      for (const m of md.emittedMetrics) {
        const name = typeof m.name === 'string' ? m.name : null;
        const value = typeof m.value === 'number' ? m.value : Number(m.value);
        if (!name || !Number.isFinite(value)) continue;
        const entry = acc.get(name) ?? { values: [], unit: null, aggregation: 'sum', latest: value };
        entry.values.push(value);
        entry.latest = value; // runs are ordered asc → last wins
        if (typeof m.unit === 'string') entry.unit = m.unit;
        if (typeof m.aggregation === 'string') entry.aggregation = m.aggregation;
        acc.set(name, entry);
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    return [...acc.entries()].map(([name, e]) => {
      let value: number;
      switch (e.aggregation) {
        case 'avg': value = e.values.reduce((a, b) => a + b, 0) / e.values.length; break;
        case 'latest': value = e.latest; break;
        case 'min': value = Math.min(...e.values); break;
        case 'max': value = Math.max(...e.values); break;
        default: value = e.values.reduce((a, b) => a + b, 0); // sum
      }
      return { name, value: round(value), unit: e.unit, aggregation: e.aggregation, runCount: e.values.length };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
}
