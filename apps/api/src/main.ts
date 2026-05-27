import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { AppModule } from './app.module';
import { webUrl, assertProdUrls } from './common/config/urls';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Fail fast in production if WEB_URL / API_URL aren't set — silently
  // mailing localhost links to real users is far worse than a boot crash.
  assertProdUrls();

  // Last-resort safety net: NestJS' WS exception handler crashes the process
  // when a non-Error rejects from a SubscribeMessage handler. Logging the
  // error and keeping the process alive is strictly better than dying mid-run.
  process.on('uncaughtException', (err) => {
    logger.error(`uncaughtException: ${err?.message ?? String(err)}`, (err as Error)?.stack);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`unhandledRejection: ${(reason as Error)?.message ?? String(reason)}`);
  });

  // 4.5 — Validate JWT secret length on startup
  const jwtSecret = process.env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    throw new Error(
      `JWT_SECRET must be at least 32 characters long (current: ${jwtSecret.length}). ` +
      'Set a strong secret in your environment before starting the server.',
    );
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
    // Capture raw request body so plugin webhook receivers (e.g. ClickUp's
    // HMAC-SHA256 over the exact bytes ClickUp sent) can verify signatures.
    { rawBody: true },
  );

  // ── Passport ↔ Fastify Express-compat shim ──────────────────────────────
  // passport-azure-ad and passport-google-oauth20 call Express-style methods
  // (`res.setHeader`, `res.end`, `res.getHeader`) directly on the response
  // when they issue the OAuth-init redirect. FastifyReply doesn't expose
  // those — without this shim every SSO start URL throws
  //   TypeError: res.setHeader is not a function
  // We tag only the auth routes (so non-passport code keeps the cleaner
  // Fastify-only reply API) and only proxy the four methods passport
  // actually uses. Pure additive — safe to leave in prod.
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('preHandler', (req, reply, done) => {
    if (!req.url?.startsWith('/api/v1/auth/')) return done();
    // Bridge passport's Express-style writes onto `reply.raw` — the bare
    // Node `http.ServerResponse` underneath Fastify, which natively has
    // setHeader / getHeader / end / statusCode. Routing through .raw
    // avoids ping-ponging through Fastify's status/header setters (which
    // re-call our shims and stack-overflow). Fastify's own send pipeline
    // is fine with the raw response being finalised externally — it
    // detects `reply.raw.writableEnded` and skips its own finalisation.
    const r = reply as unknown as Record<string, unknown>;
    const raw = reply.raw;
    if (typeof r.setHeader !== 'function') {
      r.setHeader = raw.setHeader.bind(raw);
    }
    if (typeof r.end !== 'function') {
      r.end = raw.end.bind(raw);
    }
    // statusCode: Fastify exposes a setter that calls reply.status(...) →
    // would recurse. Bind directly to the raw response's native field.
    Object.defineProperty(r, 'statusCode', {
      configurable: true,
      get: () => raw.statusCode,
      set: (v: number) => { raw.statusCode = v; },
    });
    done();
  });

  // 4.2 — Helmet security headers (Content-Security-Policy, X-Content-Type-Options, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyHelmet as any, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
      },
    },
  });

  // Register multipart/form-data support (for file uploads)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyMultipart as any, {
    limits: { fileSize: 200 * 1024 * 1024, files: 1 },
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: webUrl(), credentials: true });
  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('QA Automation Platform API')
    .setDescription('Self-hosted AI QA Automation Platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(`API running on http://localhost:${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/docs`);
}
bootstrap();
