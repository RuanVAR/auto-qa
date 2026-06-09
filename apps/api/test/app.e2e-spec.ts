import { INestApplication, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
// CJS require — supertest's module.exports is the callable itself; a default
// import doesn't resolve under ts-jest transpile-only (isolatedModules).
import request = require('supertest');

/**
 * Smoke e2e — boots the real AppModule (all global guards + the ValidationPipe)
 * behind Fastify and exercises the request pipeline end-to-end.
 *
 * IMPORTANT: this boots the WHOLE app, including the WebSocket gateway (:3002)
 * and BullMQ workers, so it must run where those ports are FREE — i.e. CI, or
 * locally only after stopping the dev/prod api (`pnpm run prod:down`). It will
 * EADDRINUSE if run while a dev api container is already listening. It also
 * needs DB/Redis/env. It is a regression net, not exhaustive coverage:
 *   - GET /api/v1/health            → 200 (public route + DB ping reachable)
 *   - GET /api/v1/projects (no auth)→ 401 (JwtAuthGuard is wired globally)
 *   - POST /api/v1/auth/login {} → 400 (global ValidationPipe rejects bad DTO)
 */
describe('API smoke (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // Mirror main.ts global config so the test exercises the same pipeline.
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await (app as NestFastifyApplication).getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/health → 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
  });

  it('GET /api/v1/projects without auth → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/projects');
    expect(res.status).toBe(401);
  });

  it('POST /api/v1/auth/login with invalid body → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email' }); // missing password, bad email
    expect(res.status).toBe(400);
  });
});
