import type { AddressInfo } from 'node:net';
import { startHealthServer } from './server';

describe('indexer health server', () => {
  it('separates liveness from dependency readiness', async () => {
    let ready = false;
    const server = startHealthServer(0, {
      workerReady: () => ready,
      database: async () => {},
      redis: async () => {},
    });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;

    await expect(fetch(`http://127.0.0.1:${port}/health`).then((response) => response.status))
      .resolves.toBe(200);
    await expect(fetch(`http://127.0.0.1:${port}/ready`).then((response) => response.status))
      .resolves.toBe(503);
    ready = true;
    await expect(fetch(`http://127.0.0.1:${port}/ready`).then((response) => response.status))
      .resolves.toBe(200);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
