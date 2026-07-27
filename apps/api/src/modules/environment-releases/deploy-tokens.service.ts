import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ProjectDeployToken } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateDeployTokenDto } from './dto/create-deploy-token.dto';

const TOKEN_PREFIX = 'qadp_';

export interface DeployTokenActorContext {
  orgId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class DeployTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(projectId: string) {
    const rows = await this.prisma.projectDeployToken.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPublic);
  }

  async issue(
    projectId: string,
    dto: CreateDeployTokenDto,
    createdById: string,
    context: DeployTokenActorContext,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, orgId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.orgId) {
      throw new BadRequestException('Deployment tokens require an organisation-scoped project');
    }
    const allowedEnvironmentIds = [...new Set(dto.allowedEnvironmentIds ?? [])];
    if (allowedEnvironmentIds.length > 0) {
      const count = await this.prisma.environment.count({
        where: { id: { in: allowedEnvironmentIds }, projectId, deletedAt: null },
      });
      if (count !== allowedEnvironmentIds.length) {
        throw new BadRequestException('Every allowed environment must belong to this project');
      }
    }

    const plaintext = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const row = await this.prisma.projectDeployToken.create({
      data: {
        orgId: project.orgId,
        projectId,
        name: dto.name.trim(),
        tokenHash: hash(plaintext),
        prefix: plaintext.slice(0, 13),
        allowedEnvironmentIds,
        expiresAt: dto.expiresInDays
          ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000)
          : null,
        createdById,
      },
    });
    await this.audit.log(
      createdById,
      'DEPLOY_TOKEN_ISSUED',
      'ProjectDeployToken',
      row.id,
      undefined,
      { projectId, name: row.name, allowedEnvironmentIds, expiresAt: row.expiresAt },
      { ...context, source: 'web' },
    );
    return { token: plaintext, record: toPublic(row) };
  }

  async revoke(
    projectId: string,
    tokenId: string,
    userId: string,
    context: DeployTokenActorContext,
  ): Promise<void> {
    const row = await this.prisma.projectDeployToken.findFirst({
      where: { id: tokenId, projectId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Deployment token not found');
    if (!row.revokedAt) {
      await this.prisma.projectDeployToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        userId,
        'DEPLOY_TOKEN_REVOKED',
        'ProjectDeployToken',
        row.id,
        { projectId, name: row.name },
        undefined,
        { ...context, source: 'web' },
      );
    }
  }

  async validate(
    plaintext: string,
    projectId: string,
    environmentId: string,
    ip?: string | null,
  ): Promise<{ tokenId: string; orgId: string }> {
    if (!plaintext.startsWith(TOKEN_PREFIX)) {
      throw new ForbiddenException('A project deployment token is required');
    }
    const row = await this.prisma.projectDeployToken.findUnique({
      where: { tokenHash: hash(plaintext) },
    });
    if (
      !row
      || row.projectId !== projectId
      || row.deletedAt
      || row.revokedAt
      || (row.expiresAt && row.expiresAt.getTime() <= Date.now())
    ) {
      throw new ForbiddenException('Invalid or expired deployment token');
    }
    if (
      row.allowedEnvironmentIds.length > 0
      && !row.allowedEnvironmentIds.includes(environmentId)
    ) {
      throw new ForbiddenException('Deployment token is not allowed for this environment');
    }
    const environment = await this.prisma.environment.findFirst({
      where: { id: environmentId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!environment) throw new ForbiddenException('Environment does not belong to this project');

    void this.prisma.projectDeployToken.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date(), lastUsedIp: ip ?? null },
    }).catch(() => undefined);
    return { tokenId: row.id, orgId: row.orgId };
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function toPublic(row: ProjectDeployToken) {
  const status = row.revokedAt
    ? 'revoked'
    : row.expiresAt && row.expiresAt.getTime() <= Date.now()
      ? 'expired'
      : 'active';
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    allowedEnvironmentIds: row.allowedEnvironmentIds,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    lastUsedIp: row.lastUsedIp,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    status,
  };
}
