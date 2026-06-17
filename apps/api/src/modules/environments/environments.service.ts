import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateEnvironmentDto } from './dto/create-environment.dto';
import { UpdateEnvironmentDto } from './dto/update-environment.dto';

/** 4.4 — Keys whose values must be masked in API responses */
const SECRET_KEY_PATTERN = /password|secret|token|key|auth|credential/i;

/** Mask a single variable map — replaces sensitive values with '••••••••' */
export function maskVariables(
  vars: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!vars) return {};
  return Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k, SECRET_KEY_PATTERN.test(k) ? '••••••••' : v]),
  );
}

/** 4.3 — Validate that baseUrl is a valid HTTP/HTTPS URL */
export function validateBaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException(`baseUrl "${url}" is not a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestException(
      `baseUrl must use http or https protocol (got "${parsed.protocol}")`,
    );
  }
}

/**
 * Probe whether an environment's baseUrl is reachable from the API host.
 * Any HTTP response (even 4xx/5xx) means the server is up → reachable. A
 * connection error or timeout means it's not. Used as a pre-flight gate for
 * automated runs so we fail fast instead of launching a browser that can't
 * load the target. Distinct from checkIframeEmbeddability (which inspects
 * X-Frame-Options/CSP, not liveness).
 */
export async function checkBaseUrlReachable(
  baseUrl: string,
  timeoutMs = 5000,
): Promise<{ reachable: boolean; reason?: string }> {
  if (!baseUrl) return { reachable: false, reason: 'No base URL configured' };
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { reachable: false, reason: `baseUrl "${baseUrl}" is not a valid URL` };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('https') as typeof import('https');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const http = require('http') as typeof import('http');
    const client = url.protocol === 'https:' ? https : http;
    return await new Promise<{ reachable: boolean; reason?: string }>((resolve) => {
      const req = client.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname || '/',
          method: 'HEAD',
          timeout: timeoutMs,
        },
        () => resolve({ reachable: true }),
      );
      req.on('error', (err) => resolve({ reachable: false, reason: (err as Error).message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ reachable: false, reason: `No response within ${timeoutMs}ms` });
      });
      req.end();
    });
  } catch (err) {
    return { reachable: false, reason: (err as Error).message };
  }
}

@Injectable()
export class EnvironmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** A user's saved env for this project. A deleted env → null so the caller
   *  falls back to the project default (env[0]). */
  async getEnvPreference(userId: string, projectId: string): Promise<{ environmentId: string | null }> {
    const pref = await this.prisma.userEnvPreference.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { environmentId: true, environment: { select: { deletedAt: true } } },
    });
    if (!pref || pref.environment?.deletedAt) return { environmentId: null };
    return { environmentId: pref.environmentId };
  }

  /** Persist the user's working env for this project (env switcher). */
  async setEnvPreference(userId: string, projectId: string, environmentId: string): Promise<{ environmentId: string }> {
    const env = await this.prisma.environment.findFirst({
      where: { id: environmentId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!env) throw new BadRequestException('Environment not found in this project');
    await this.prisma.userEnvPreference.upsert({
      where: { userId_projectId: { userId, projectId } },
      create: { userId, projectId, environmentId },
      update: { environmentId },
    });
    return { environmentId };
  }

  async findByProject(projectId: string, opts?: { includeArchived?: boolean }) {
    // includeArchived=true is used by the env management page to surface
    // soft-deleted envs in a separate "Archived" section so the user can
    // restore them. Everywhere else (test mode pickers, run config, …)
    // calls without the flag and gets only active envs — archived envs
    // must NOT appear in any operational dropdown.
    const envs = await this.prisma.environment.findMany({
      where: { projectId, ...(opts?.includeArchived ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
    return envs.map((e) => ({
      ...e,
      variables: maskVariables(e.variables as Record<string, string>),
    }));
  }

  async findOne(id: string) {
    const env = await this.prisma.environment.findUnique({ where: { id } });
    if (!env) throw new NotFoundException('Environment not found');
    return { ...env, variables: maskVariables(env.variables as Record<string, string>) };
  }

  create(projectId: string, dto: CreateEnvironmentDto) {
    validateBaseUrl(dto.baseUrl);
    return this.prisma.environment.create({ data: { ...dto, projectId } });
  }

  async update(id: string, dto: UpdateEnvironmentDto) {
    await this.findOne(id);
    if (dto.baseUrl) validateBaseUrl(dto.baseUrl);
    return this.prisma.environment.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.environment.update({ where: { id }, data: { isActive: false } });
  }

  /** Re-enable a previously archived environment. Idempotent on already-active rows. */
  async restore(id: string) {
    await this.findOne(id);
    return this.prisma.environment.update({ where: { id }, data: { isActive: true } });
  }

  async checkIframeEmbeddability(id: string) {
    const env = await this.prisma.environment.findUnique({ where: { id } });
    if (!env?.baseUrl) return { embeddable: false, reason: 'No base URL configured' };
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const https = require('https') as typeof import('https');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const http = require('http') as typeof import('http');
      const url = new URL(env.baseUrl);
      const client = url.protocol === 'https:' ? https : http;
      const result = await new Promise<{ embeddable: boolean; reason?: string }>((resolve) => {
        const req = client.request(
          {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname || '/',
            method: 'HEAD',
            timeout: 5000,
          },
          (res) => {
            const xfo = (res.headers['x-frame-options'] ?? '') as string;
            const csp = (res.headers['content-security-policy'] ?? '') as string;
            if (
              xfo.toUpperCase().includes('DENY') ||
              xfo.toUpperCase().includes('SAMEORIGIN') ||
              (csp.includes('frame-ancestors') && !csp.includes('frame-ancestors *'))
            ) {
              resolve({ embeddable: false, reason: 'X-Frame-Options or CSP blocks embedding' });
            } else {
              resolve({ embeddable: true });
            }
          },
        );
        req.on('error', () => resolve({ embeddable: true })); // assume embeddable on error
        req.on('timeout', () => { req.destroy(); resolve({ embeddable: true }); });
        req.end();
      });
      return result;
    } catch {
      return { embeddable: true };
    }
  }
}
