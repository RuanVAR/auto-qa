import http from 'node:http';

export interface ReadinessChecks {
  database(): Promise<void>;
  redis(): Promise<void>;
  workerReady(): boolean;
}

export function startHealthServer(
  port: number,
  checks: ReadinessChecks,
): http.Server {
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'GET') {
      respond(response, 405, { error: 'Method Not Allowed' });
      return;
    }
    if (request.url === '/health') {
      respond(response, 200, { ok: true, service: 'code-indexer' });
      return;
    }
    if (request.url === '/ready') {
      try {
        if (!checks.workerReady()) throw new Error('Queue consumer is not ready');
        await Promise.all([checks.database(), checks.redis()]);
        respond(response, 200, { ready: true, service: 'code-indexer' });
      } catch (error) {
        respond(response, 503, {
          ready: false,
          error: error instanceof Error ? error.message : 'Readiness check failed',
        });
      }
      return;
    }
    respond(response, 404, { error: 'Not Found' });
  });
  server.listen(port, '0.0.0.0');
  return server;
}

function respond(
  response: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}
