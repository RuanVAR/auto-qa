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
import { Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@WebSocketGateway(3002, { cors: { origin: '*' }, namespace: '/screencast' })
export class ScreencastGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ScreencastGateway.name);
  private subscriber!: Redis;
  // Map from runId to set of client IDs watching it
  private watchers = new Map<string, Set<string>>();

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.subscriber = new Redis(redisUrl);
    this.subscriber.on('message', (channel: string, message: string) => {
      // channel = "screencast:{runId}"
      const runId = channel.replace('screencast:', '');
      this.server
        .to(`screencast:${runId}`)
        .emit('screencast:frame', JSON.parse(message));
    });
  }

  async onModuleDestroy() {
    await this.subscriber.quit();
  }

  handleConnection(client: Socket) {
    this.logger.log(`Screencast client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    // Clean up all watcher entries for this client
    for (const [runId, clients] of this.watchers.entries()) {
      if (clients.has(client.id)) {
        clients.delete(client.id);
        if (clients.size === 0) {
          this.watchers.delete(runId);
          this.subscriber.unsubscribe(`screencast:${runId}`).catch(() => {});
        }
      }
    }
  }

  @SubscribeMessage('watch:run')
  async handleWatch(
    @MessageBody() body: string | { runId: string } | undefined | null,
    @ConnectedSocket() client: Socket,
  ) {
    // Defensive: a malformed payload or a Redis hiccup must never crash the
    // process. NestJS' WsExceptionsHandler does `instanceof WsException` on
    // whatever bubbles up — if a non-Error rejects, it crashes the API.
    try {
      if (!body) return;
      const runId = typeof body === 'string' ? body : body.runId;
      if (!runId || typeof runId !== 'string') return;
      client.join(`screencast:${runId}`);
      if (!this.watchers.has(runId)) {
        this.watchers.set(runId, new Set());
        await this.subscriber.subscribe(`screencast:${runId}`);
      }
      this.watchers.get(runId)!.add(client.id);
    } catch (err) {
      this.logger.warn(`watch:run failed: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  @SubscribeMessage('unwatch:run')
  async handleUnwatch(
    @MessageBody() body: string | { runId: string } | undefined | null,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      if (!body) return;
      const runId = typeof body === 'string' ? body : body.runId;
      if (!runId || typeof runId !== 'string') return;
      client.leave(`screencast:${runId}`);
      const clients = this.watchers.get(runId);
      if (clients) {
        clients.delete(client.id);
        if (clients.size === 0) {
          this.watchers.delete(runId);
          await this.subscriber.unsubscribe(`screencast:${runId}`);
        }
      }
    } catch (err) {
      this.logger.warn(`unwatch:run failed: ${(err as Error)?.message ?? String(err)}`);
    }
  }
}
