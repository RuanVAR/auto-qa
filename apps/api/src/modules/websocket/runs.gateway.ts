import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import type { RepoIndexProgressEvent } from '@qa-platform/shared';
import { accessCtx } from '../../common/access/access-context';
import { EnvAccessService } from '../../common/access/env-access.service';
import { TokenService } from '../auth/token.service';

@WebSocketGateway(3002, {
  cors: { origin: '*', credentials: false },
  namespace: '/',
})
export class RunsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RunsGateway.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly envAccess: EnvAccessService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /** Client subscribes to a specific run's events */
  @SubscribeMessage('watch:run')
  handleWatchRun(@MessageBody() runId: string, @ConnectedSocket() client: Socket) {
    client.join(`run:${runId}`);
    this.logger.log(`Client ${client.id} watching run ${runId}`);
  }

  /** Client unsubscribes from a run */
  @SubscribeMessage('unwatch:run')
  handleUnwatchRun(@MessageBody() runId: string, @ConnectedSocket() client: Socket) {
    client.leave(`run:${runId}`);
  }

  /** Client subscribes to all runs for a project */
  @SubscribeMessage('watch:project')
  async handleWatchProject(
    @MessageBody() input: { projectId?: string; token?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const projectId = input?.projectId?.trim();
    const token = input?.token?.trim();
    if (!projectId || !token) {
      client.emit('project:watch-denied', {
        projectId: projectId ?? null,
        message: 'Authentication required',
      });
      return { ok: false };
    }
    try {
      const user = await this.tokens.authenticateAccessToken(token);
      await this.envAccess.assertProjectAccess(
        user.sub,
        projectId,
        accessCtx(user),
      );
      await client.join(`project:${projectId}`);
      return { ok: true };
    } catch {
      client.emit('project:watch-denied', {
        projectId,
        message: 'Project access denied',
      });
      return { ok: false };
    }
  }

  @SubscribeMessage('unwatch:project')
  handleUnwatchProject(@MessageBody() projectId: string, @ConnectedSocket() client: Socket) {
    client.leave(`project:${projectId}`);
  }

  /** Client subscribes to a FeatureRun (for live per-test status in FeaturePage) */
  @SubscribeMessage('watch:featureRun')
  handleWatchFeatureRun(@MessageBody() featureRunId: string, @ConnectedSocket() client: Socket) {
    client.join(`featureRun:${featureRunId}`);
    this.logger.log(`Client ${client.id} watching featureRun ${featureRunId}`);
  }

  @SubscribeMessage('unwatch:featureRun')
  handleUnwatchFeatureRun(@MessageBody() featureRunId: string, @ConnectedSocket() client: Socket) {
    client.leave(`featureRun:${featureRunId}`);
  }

  /** Client subscribes to a PipelineRun (live stage timeline in the panel) */
  @SubscribeMessage('watch:pipelineRun')
  handleWatchPipelineRun(@MessageBody() pipelineRunId: string, @ConnectedSocket() client: Socket) {
    client.join(`pipelineRun:${pipelineRunId}`);
  }

  @SubscribeMessage('unwatch:pipelineRun')
  handleUnwatchPipelineRun(@MessageBody() pipelineRunId: string, @ConnectedSocket() client: Socket) {
    client.leave(`pipelineRun:${pipelineRunId}`);
  }

  /** Emitted by PipelinesService on every stage transition + finalization. */
  emitPipelineRunUpdated(run: {
    id: string;
    pipelineId: string;
    status: string;
    currentStageOrder: number;
    stageResults: unknown;
  }) {
    this.server.to(`pipelineRun:${run.id}`).emit('pipelineRun:updated', run);
  }

  /** Emitted by RunsService when a run status changes */
  emitRunUpdated(run: {
    id: string;
    status: string;
    projectId: string;
    startedAt: Date | null;
    completedAt: Date | null;
    duration: number | null;
    errorMessage: string | null;
  }) {
    this.server.to(`run:${run.id}`).emit('run:updated', run);
    this.server.to(`project:${run.projectId}`).emit('run:updated', run);
  }

  emitRepoIndexProgress(payload: RepoIndexProgressEvent) {
    this.server
      .to(`project:${payload.projectId}`)
      .emit('repo:index-progress', payload);
  }

  /** Emitted when a run step completes */
  emitStepCompleted(payload: {
    runId: string;
    stepId: string;
    index: number;
    status: string;
    screenshotPath: string | null;
    duration: number | null;
    errorMessage: string | null;
  }) {
    this.server.to(`run:${payload.runId}`).emit('step:completed', payload);
  }

  /** Emitted when a step fails (for failure action panel) */
  emitStepFailed(payload: {
    runId: string;
    stepId: string;
    index: number;
    stepName: string;
    errorMessage: string | null;
  }) {
    this.server.to(`run:${payload.runId}`).emit('step:failed', payload);
  }

  /** Emitted after a cancelled TestRun's worker has fully torn down the
   *  browser. The web UI gates "switch to manual" on this event. */
  emitRunAbortCompleted(payload: {
    runId: string;
    projectId: string;
    featureRunId: string | null;
  }) {
    this.server.to(`run:${payload.runId}`).emit('run:abortCompleted', payload);
    if (payload.featureRunId) {
      this.server.to(`featureRun:${payload.featureRunId}`).emit('run:abortCompleted', payload);
    }
    this.server.to(`project:${payload.projectId}`).emit('run:abortCompleted', payload);
  }

  /** Emitted when a FeatureRun status changes */
  emitFeatureRunUpdated(featureRun: {
    id: string;
    featureId: string;
    status: string;
    passedCount?: number;
    failedCount?: number;
  }) {
    this.server.to(`featureRun:${featureRun.id}`).emit('featureRun:updated', featureRun);
  }

  /**
   * Emitted when an individual TestRun inside a FeatureRun changes status.
   * Clients watching the FeatureRun room receive this to update per-row icons.
   */
  emitFeatureRunTestRunUpdated(payload: {
    featureRunId: string;
    testRunId: string;
    status: string;
  }) {
    this.server
      .to(`featureRun:${payload.featureRunId}`)
      .emit('featureRun:testRunUpdated', payload);
  }
}
