import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isProd } from '../config/app';

/**
 * Catch-all exception filter — one consistent error envelope for the whole API.
 *
 * Preserves the existing `{ statusCode, error, message }` shape so clients that
 * read `response.data.message` keep working, and adds `path` + `timestamp`.
 * Beyond Nest HttpExceptions it also:
 *   - maps Prisma known errors to proper HTTP codes (P2002 → 409, P2025 → 404)
 *     instead of leaking them as unmapped 500s, and
 *   - returns a generic message for unexpected 5xx in production (never leaks an
 *     internal error string), while logging the full error + stack server-side.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const req = http.getRequest<FastifyRequest>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      // Reproduce Nest's existing body exactly (message + error preserved).
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        error = exception.name.replace(/Exception$/, '');
      } else {
        const b = body as { message?: string | string[]; error?: string };
        message = b.message ?? exception.message;
        error = b.error ?? exception.name.replace(/Exception$/, '');
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT; error = 'Conflict'; message = 'A record with these values already exists';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND; error = 'Not Found'; message = 'Record not found';
      } else {
        status = HttpStatus.BAD_REQUEST; error = 'Bad Request'; message = 'Invalid database request';
      }
      this.logger.warn(`Prisma ${exception.code} on ${req.method} ${req.url}`);
    } else if (exception instanceof Error) {
      message = isProd() ? 'Internal server error' : exception.message;
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status}: ${(exception as Error)?.message ?? String(exception)}`,
        (exception as Error)?.stack,
      );
    }

    reply.status(status).send({ statusCode: status, error, message, path: req.url, timestamp: new Date().toISOString() });
  }
}
