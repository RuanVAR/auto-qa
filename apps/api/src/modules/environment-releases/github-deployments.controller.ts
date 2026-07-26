import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  EnvironmentReleaseSource,
  EnvironmentReleaseStatus,
  Prisma,
} from '@prisma/client';
import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvironmentReleasesService } from './environment-releases.service';

interface GitHubDeploymentPayload {
  deployment?: {
    id?: number | string;
    sha?: string;
    ref?: string;
    environment?: string;
    payload?: unknown;
  };
  deployment_status?: {
    id?: number | string;
    state?: string;
    target_url?: string;
    environment_url?: string;
    created_at?: string;
  };
  repository?: {
    full_name?: string;
  };
}

@ApiTags('webhooks')
@Controller('webhooks/github/deployments')
export class GithubDeploymentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly releases: EnvironmentReleasesService,
  ) {}

  @Post(':repoId')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Verified GitHub deployment_status webhook receiver' })
  async receive(
    @Param('repoId') repoId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: { rawBody?: Buffer },
    @Body() body: GitHubDeploymentPayload,
  ) {
    const repo = await this.prisma.projectRepo.findFirst({
      where: { id: repoId, deletedAt: null },
    });
    if (!repo?.webhookSecret) return { ok: false };

    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(body ?? {}));
    const digest = createHash('sha256').update(rawBody).digest('hex');
    const deliveryId = first(headers['x-github-delivery'])?.trim();
    const event = first(headers['x-github-event'])?.trim() ?? 'unknown';
    const signature = first(headers['x-hub-signature-256']);
    if (!deliveryId || !validSignature(rawBody, signature, repo.webhookSecret)) {
      if (deliveryId) {
        await this.audit(repo, deliveryId, event, digest, false, 'INVALID_SIGNATURE');
      }
      return { ok: false };
    }

    try {
      await this.prisma.gitHubWebhookDelivery.create({
        data: {
          orgId: repo.orgId,
          projectId: repo.projectId,
          projectRepoId: repo.id,
          deliveryId,
          event,
          payloadDigest: digest,
          signatureOk: true,
          outcome: 'PROCESSING',
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: true, duplicate: true };
      throw error;
    }

    if (event !== 'deployment_status') {
      await this.setOutcome(repo.id, deliveryId, 'IGNORED_EVENT');
      return { ok: true, ignored: true };
    }
    if (
      body.repository?.full_name
      && body.repository.full_name.toLowerCase()
        !== `${repo.repoOwner}/${repo.repoName}`.toLowerCase()
    ) {
      await this.setOutcome(repo.id, deliveryId, 'REPOSITORY_MISMATCH');
      return { ok: false };
    }

    const status = mapStatus(body.deployment_status?.state);
    if (!status) {
      await this.setOutcome(repo.id, deliveryId, 'IGNORED_STATE');
      return { ok: true, ignored: true };
    }

    const deploymentMetadata = metadata(body.deployment?.payload);
    const environmentId = typeof deploymentMetadata.environmentId === 'string'
      ? deploymentMetadata.environmentId
      : null;
    const environmentName = body.deployment?.environment?.trim();
    const environment = environmentId
      ? await this.prisma.environment.findFirst({
          where: { id: environmentId, projectId: repo.projectId, deletedAt: null },
        })
      : environmentName
        ? await this.prisma.environment.findFirst({
            where: {
              projectId: repo.projectId,
              name: { equals: environmentName, mode: 'insensitive' },
              deletedAt: null,
            },
          })
        : null;
    if (!environment) {
      await this.setOutcome(repo.id, deliveryId, 'ENVIRONMENT_NOT_MAPPED');
      return { ok: true, ignored: true };
    }

    const releaseVersion = stringValue(
      deploymentMetadata.releaseVersion ?? deploymentMetadata.version,
    );
    try {
      const release = await this.releases.recordDeployment(
        repo.projectId,
        environment.id,
        {
          status,
          releaseVersion: releaseVersion ?? undefined,
          repoId: repo.id,
          componentName: stringValue(deploymentMetadata.componentName) ?? undefined,
          version: stringValue(deploymentMetadata.componentVersion) ?? undefined,
          commitSha: body.deployment?.sha,
          branch: body.deployment?.ref,
          artifactDigest: stringValue(deploymentMetadata.artifactDigest) ?? undefined,
          externalDeploymentId: body.deployment?.id != null
            ? String(body.deployment.id)
            : undefined,
          pipelineUrl: body.deployment_status?.target_url
            || body.deployment_status?.environment_url
            || undefined,
          deployedAt: body.deployment_status?.created_at,
          metadata: {
            githubDeliveryId: deliveryId,
            githubDeploymentStatusId: body.deployment_status?.id ?? null,
          },
        },
        EnvironmentReleaseSource.GITHUB_DEPLOYMENT,
        `github:${deliveryId}`,
      );
      await this.setOutcome(repo.id, deliveryId, `RECORDED:${release.id}`);
      return { ok: true, releaseId: release.id };
    } catch (error) {
      await this.setOutcome(
        repo.id,
        deliveryId,
        `ERROR:${error instanceof Error ? error.message.slice(0, 180) : 'unknown'}`,
      );
      return { ok: false };
    }
  }

  private audit(
    repo: { id: string; orgId: string; projectId: string },
    deliveryId: string,
    event: string,
    payloadDigest: string,
    signatureOk: boolean,
    outcome: string,
  ) {
    return this.prisma.gitHubWebhookDelivery.upsert({
      where: {
        projectRepoId_deliveryId: {
          projectRepoId: repo.id,
          deliveryId,
        },
      },
      create: {
        orgId: repo.orgId,
        projectId: repo.projectId,
        projectRepoId: repo.id,
        deliveryId,
        event,
        payloadDigest,
        signatureOk,
        outcome,
      },
      update: { signatureOk, outcome, payloadDigest },
    }).catch(() => undefined);
  }

  private setOutcome(projectRepoId: string, deliveryId: string, outcome: string) {
    return this.prisma.gitHubWebhookDelivery.update({
      where: {
        projectRepoId_deliveryId: {
          projectRepoId,
          deliveryId,
        },
      },
      data: { outcome, processedAt: new Date() },
    });
  }
}

function validSignature(rawBody: Buffer, supplied: string | undefined, secret: string): boolean {
  if (!supplied?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const actualBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

function mapStatus(value?: string): EnvironmentReleaseStatus | null {
  switch (value?.toLowerCase()) {
    case 'success':
      return EnvironmentReleaseStatus.SUCCESS;
    case 'failure':
    case 'error':
      return EnvironmentReleaseStatus.FAILED;
    case 'pending':
    case 'queued':
    case 'in_progress':
      return EnvironmentReleaseStatus.PENDING;
    case 'inactive':
      return EnvironmentReleaseStatus.ROLLED_BACK;
    default:
      return null;
  }
}

function metadata(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
