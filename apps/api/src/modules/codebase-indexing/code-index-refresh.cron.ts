import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { RepoIndexStatus } from '@prisma/client';
import { scrubString } from '@qa-platform/shared';
import { CronLock } from '../../common/cron-lock';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CodeIndexRequestService } from './code-index-request.service';

const DEFAULT_STALE_HOURS = 24;
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;

@Injectable()
export class CodeIndexRefreshCron {
  private readonly logger = new Logger(CodeIndexRefreshCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: CodeIndexRequestService,
    private readonly config: ConfigService,
  ) {}

  @Cron(process.env.CODE_INDEX_CRON ?? '0 1 * * *', {
    name: 'code-index-refresh',
  })
  @CronLock('code-index-refresh', { ttl: 3600 })
  async tick(): Promise<void> {
    if (!enabled(this.config.get<string>('CODE_INDEX_ENABLED'))) return;

    const staleHours = positiveInteger(
      this.config.get<string>('CODE_INDEX_STALE_HOURS'),
      DEFAULT_STALE_HOURS,
      'CODE_INDEX_STALE_HOURS',
    );
    const batchSize = Math.min(
      positiveInteger(
        this.config.get<string>('CODE_INDEX_CRON_BATCH_SIZE'),
        DEFAULT_BATCH_SIZE,
        'CODE_INDEX_CRON_BATCH_SIZE',
      ),
      MAX_BATCH_SIZE,
    );
    const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1_000);
    const candidates = await this.prisma.repoBranchIndex.findMany({
      where: {
        deletedAt: null,
        projectRepo: { deletedAt: null },
        OR: [
          {
            status: RepoIndexStatus.READY,
            OR: [
              { lastIndexedAt: { lte: cutoff } },
              {
                lastIndexedAt: null,
                lastRequestedAt: { lte: cutoff },
              },
              {
                lastIndexedAt: null,
                lastRequestedAt: null,
                createdAt: { lte: cutoff },
              },
            ],
          },
          {
            status: RepoIndexStatus.FAILED,
            OR: [
              { lastRequestedAt: { lte: cutoff } },
              {
                lastRequestedAt: null,
                updatedAt: { lte: cutoff },
              },
            ],
          },
        ],
      },
      orderBy: [
        { lastRequestedAt: 'asc' },
        { lastIndexedAt: 'asc' },
        { createdAt: 'asc' },
      ],
      take: batchSize,
      select: {
        id: true,
        projectId: true,
        projectRepoId: true,
        branch: true,
      },
    });

    if (candidates.length === 0) return;
    this.logger.log(
      `Scheduled refresh found ${candidates.length} stale branch index(es)`,
    );

    let queued = 0;
    for (const candidate of candidates) {
      try {
        await this.requests.request({
          projectId: candidate.projectId,
          repoId: candidate.projectRepoId,
          branch: candidate.branch,
          force: false,
          trigger: 'SCHEDULED',
        });
        queued++;
      } catch (error) {
        this.logger.warn(
          `Could not schedule branch index ${candidate.id}: ${safeMessage(error)}`,
        );
      }
    }
    this.logger.log(
      `Scheduled refresh queued ${queued}/${candidates.length} branch index(es)`,
    );
  }
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function safeMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  return scrubString(error.message).slice(0, 300);
}
