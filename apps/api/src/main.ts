import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
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

    // ── Response-side shims ────────────────────────────────────────────
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
    // passport-azure-ad's cookieContentHandler calls `res.cookie(name,
    // value, options)` (Express API). We CAN'T let that fall through to
    // Fastify's `reply.cookie(...)` (added by @fastify/cookie) — that
    // queues the cookie onto reply and only flushes the Set-Cookie header
    // during reply.send(). Passport bypasses that pipeline by calling
    // `res.end()` directly (which our shim routes to raw.end, skipping
    // Fastify's send entirely), so a queued cookie never reaches the
    // wire. Result: callback gets no state cookie, passport returns 401
    // silently in <10ms with no log.
    //
    // Always override (don't guard on existing `cookie` — @fastify/cookie
    // already added one and it's exactly the broken-in-this-context one).
    // Serialize the cookie manually and write Set-Cookie straight to
    // raw.setHeader so it survives our raw.end path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.cookie = (name: string, value: string, options: any = {}) => {
      let header = `${name}=${value ?? ''}`;
      if (options.maxAge != null) {
        // Express convention is milliseconds; RFC 6265 wants seconds.
        header += `; Max-Age=${Math.floor(Number(options.maxAge) / 1000)}`;
      }
      if (options.domain) header += `; Domain=${options.domain}`;
      header += `; Path=${options.path ?? '/'}`;
      if (options.httpOnly) header += '; HttpOnly';
      if (options.secure) header += '; Secure';
      if (options.sameSite) header += `; SameSite=${options.sameSite}`;
      // Append to any existing Set-Cookie rather than clobbering — one
      // response can carry multiple cookies, and passport-aad rotates
      // its cookie name with a timestamp prefix per request.
      const existing = raw.getHeader('Set-Cookie');
      const next = Array.isArray(existing)
        ? [...existing, header]
        : existing
          ? [String(existing), header]
          : [header];
      raw.setHeader('Set-Cookie', next);
    };

    // ── Request-side shims ─────────────────────────────────────────────
    // passport-azure-ad reads `req.res` (Express convention — the
    // response hangs off the request) inside flowInitializationHandler:
    //   const response = options && options.response || req.res;
    // Fastify doesn't attach it, so passport ends up passing `undefined`
    // as the `res` arg into cookieContentHandler.add → `res.cookie(...)`
    // crashes "Cannot read properties of undefined (reading 'cookie')".
    // Attach our reply so passport finds it.
    //
    // Also `req.get(headerName)` (Express helper) is undefined on
    // FastifyRequest — passport calls it to inspect the user agent.
    const rq = req as unknown as Record<string, unknown>;
    if (!rq.res) rq.res = reply;
    if (typeof rq.get !== 'function') {
      rq.get = (name: string) => {
        const v = req.headers[name.toLowerCase()];
        return Array.isArray(v) ? v[0] : v;
      };
    }
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

  // Parse incoming Cookie headers into req.cookies — required by
  // passport-azure-ad's OIDCStrategy in cookie-storage mode (we use it
  // instead of express-session because the API is stateless). Without
  // this, the callback handler crashes with:
  //   "Cookie is not found in request. Did you forget to use cookie
  //   parsing middleware such as cookie-parser?"
  // We don't set a `secret` here — passport-azure-ad encrypts the cookie
  // payload itself (AES-GCM via cookieEncryptionKeys, derived from
  // JWT_SECRET in microsoft.strategy.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyCookie as any);

  // whitelist strips unknown props; forbidNonWhitelisted turns "silently
  // dropped" into a 400 so client/contract drift surfaces instead of hiding.
  // NOTE: only affects endpoints with a DTO class — inline `@Body()` object
  // literals have no metadata to validate against (see audit 2.2).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: webUrl(), credentials: true });
  app.setGlobalPrefix('api/v1');

  // Swagger /docs enumerates every route + schema. Useful in dev, but in
  // production it's free reconnaissance for an attacker — gate it behind a
  // non-production check (set SWAGGER_ENABLED=true to force it on for a
  // staging box if needed).
  const swaggerEnabled =
    process.env.SWAGGER_ENABLED === 'true' ||
    (process.env.NODE_ENV ?? 'development') !== 'production';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('QA Automation Platform API')
      .setDescription('Self-hosted AI QA Automation Platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }

  // Graceful shutdown: on SIGTERM/SIGINT Nest runs module lifecycle hooks —
  // Fastify drains in-flight HTTP requests, PrismaService disconnects, and the
  // BullMQ queues close their Redis connections (QueueService.onApplicationShutdown).
  // Without this, a deploy/scale-down kills the process mid-request and orphans
  // connections.
  app.enableShutdownHooks();

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(`API running on http://localhost:${port}`);
  if (swaggerEnabled) logger.log(`Swagger docs: http://localhost:${port}/docs`);
}
bootstrap();
