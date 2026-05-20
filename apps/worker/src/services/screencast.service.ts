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
    if (!this.enabled) {
      console.log(`[screencast ${this.runId}] disabled via SCREENCAST_ENABLED=false`);
      return;
    }
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
      let publishErrors = 0;

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
          const subs = await this.redis.publish(`screencast:${this.runId}`, payload);
          // Log first frame + every 50th frame so we can confirm streaming.
          if (frameCount === 1 || frameCount % 50 === 0) {
            console.log(`[screencast ${this.runId}] frame ${frameCount} published, ${subs} subscriber(s)`);
          }
        } catch (e) {
          if (publishErrors++ < 3) {
            console.warn(`[screencast ${this.runId}] publish error:`, (e as Error).message);
          }
        }
      });

      this._cdpSession = cdpSession as { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> };
      console.log(`[screencast ${this.runId}] started (CDP) quality=${quality} ${maxWidth}x${maxHeight}`);
    } catch (e) {
      console.error(`[screencast ${this.runId}] start failed:`, (e as Error).message);
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
