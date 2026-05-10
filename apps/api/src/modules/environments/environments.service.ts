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

@Injectable()
export class EnvironmentsService {
  constructor(private readonly prisma: PrismaService) {}

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
