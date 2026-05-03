import { Page } from 'playwright';
import Redis from 'ioredis';

export class ScreencastService {
  private redis: Redis;
  private page: Page;
  private runId: string;
  private enabled: boolean;
  private _cdpSession?: { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> };

  constructor(page: Page, runId: string) {
    this.page = page;
    this.runId = runId;
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.redis = new Redis(redisUrl, { lazyConnect: true, enableOfflineQueue: false });
    this.enabled = process.env.SCREENCAST_ENABLED !== 'false';
  }

  async start(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.redis.connect();
      const cdpSession = await this.page.context().newCDPSession(this.page);
      const quality = Number(process.env.SCREENCAST_QUALITY ?? 40);
      const maxWidth = Number(process.env.SCREENCAST_MAX_WIDTH ?? 1280);
      const maxHeight = Number(process.env.SCREENCAST_MAX_HEIGHT ?? 800);

      await cdpSession.send('Page.startScreencast', {
        format: 'jpeg',
        quality,
        maxWidth,
        maxHeight,
        everyNthFrame: 1,
      });

      let frameCount = 0;
      let lastPublishTime = 0;

      cdpSession.on('Page.screencastFrame', async (event: { data: string; sessionId: number }) => {
        try {
          await cdpSession.send('Page.screencastFrameAck', { sessionId: event.sessionId });
          const now = Date.now();
          // Adaptive throttle: if last publish was < 100ms ago, skip
          if (now - lastPublishTime < 100) return;
          lastPublishTime = now;

          const payload = JSON.stringify({
            runId: this.runId,
            frameBase64: event.data,
            timestamp: now,
            frameNumber: ++frameCount,
          });
          await this.redis.publish(`screencast:${this.runId}`, payload);
        } catch {
          // Ignore publish errors
        }
      });

      this._cdpSession = cdpSession as { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> };
    } catch {
      // CDP not available (headless=false disabled, or browser doesn't support) — ignore
    }
  }

  async stop(): Promise<void> {
    if (!this.enabled) return;
    try {
      if (this._cdpSession) {
        await this._cdpSession.send('Page.stopScreencast');
      }
      await this.redis.quit();
    } catch {
      // Ignore cleanup errors
    }
  }
}
