import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

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
  );

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
  app.enableCors({ origin: process.env.WEB_URL || 'http://localhost:3000', credentials: true });
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
