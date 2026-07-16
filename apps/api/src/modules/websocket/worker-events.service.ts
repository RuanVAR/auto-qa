import { Injectable, Logger, OnModuleInit, OnModuleDestroy, forwardRef, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { RunsGateway } from './runs.gateway';
import { FeatureRunsService } from '../feature-runs/feature-runs.service';
import { PipelinesService } from '../pipelines/pipelines.service';

const TERMINAL_RUN_STATUSES = new Set(['PASSED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'ERROR']);

@Injectable()
export class WorkerEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerEventsService.name);
  private subscriber!: Redis;

  constructor(
    private readonly gateway: RunsGateway,
    @Inject(forwardRef(() => FeatureRunsService))
    private readonly featureRunsService: FeatureRunsService,
    @Inject(forwardRef(() => PipelinesService))
    private readonly pipelinesService: PipelinesService,
  ) {}

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.subscriber = new Redis(redisUrl);
    this.subscriber.subscribe('worker:events', (err) => {
      if (err) this.logger.error('Failed to subscribe to worker:events', err);
      else this.logger.log('Subscribed to worker:events');
    });
    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as {
          type: string;
          payload: Record<string, unknown>;
        };
        if (event.type === 'run:updated') {
          this.gateway.emitRunUpdated(
            event.payload as Parameters<RunsGateway['emitRunUpdated']>[0],
          );
          const status = event.payload['status'] as string | undefined;
          const runId = event.payload['id'] as string | undefined;
          const featureRunId = event.payload['featureRunId'] as string | undefined;

          // Push per-TestRun status into the featureRun room so FeaturePage updates instantly
          if (featureRunId && runId && status) {
            this.gateway.emitFeatureRunTestRunUpdated({ featureRunId, testRunId: runId, status });
          }

          if (runId && status && TERMINAL_RUN_STATUSES.has(status)) {
            // Pipeline advance is chained AFTER completion processing (which
            // marks the FeatureRun COMPLETE) and errors are caught separately
            // — a pipelines bug can never break normal run completion.
            this.featureRunsService.onRunComplete(runId)
              .then(() => {
                if (featureRunId) {
                  return this.pipelinesService.onFeatureRunMaybeTerminal(featureRunId);
                }
                return undefined;
              })
              .catch((err: unknown) => {
                this.logger.error(`onRunComplete/pipeline advance failed for run ${runId}`, err);
              });
          }
        } else if (event.type === 'run:abortCompleted') {
          // Worker confirmed the cancelled run's browser has been fully torn
          // down. Forward to the run + featureRun rooms so the web UI can
          // unlock the "switch to manual" affordance.
          this.gateway.emitRunAbortCompleted(
            event.payload as Parameters<RunsGateway['emitRunAbortCompleted']>[0],
          );
        } else if (event.type === 'step:completed') {
          this.gateway.emitStepCompleted(
            event.payload as Parameters<RunsGateway['emitStepCompleted']>[0],
          );
        } else if (event.type === 'step:failed') {
          this.gateway.emitStepFailed(
            event.payload as Parameters<RunsGateway['emitStepFailed']>[0],
          );
        }
      } catch (err) {
        this.logger.error('Failed to process worker event', err);
      }
    });
  }

  async onModuleDestroy() {
    await this.subscriber.quit();
  }
}
