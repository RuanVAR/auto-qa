import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EnvironmentReleaseSource,
  EnvironmentReleaseStatus,
  Prisma,
  RepoRole,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { apiUrl } from '../../common/config/urls';
import { ProjectReposService } from '../github-integration/project-repos.service';
import {
  CreateDeploymentDto,
  DeploymentComponentDto,
} from './dto/create-deployment.dto';
import {
  ResolvedManifestVersion,
  VersionResolverService,
} from './version-resolver.service';

interface PreparedComponent {
  projectRepoId: string | null;
  componentKey: string;
  componentName: string;
  version: string | null;
  commitSha: string | null;
  branch: string | null;
  artifactDigest: string | null;
  manifestPath: string | null;
  metadata: Record<string, unknown> | null;
}

@Injectable()
export class EnvironmentReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repos: ProjectReposService,
    private readonly versions: VersionResolverService,
  ) {}

  async currentReleaseId(environmentId?: string | null): Promise<string | null> {
    if (!environmentId) return null;
    const current = await this.prisma.environmentRelease.findFirst({
      where: {
        environmentId,
        status: EnvironmentReleaseStatus.SUCCESS,
        deletedAt: null,
      },
      select: { id: true },
      orderBy: [{ deployedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return current?.id ?? null;
  }

  async current(projectId: string, environmentId: string) {
    await this.assertEnvironment(projectId, environmentId);
    const row = await this.prisma.environmentRelease.findFirst({
      where: {
        projectId,
        environmentId,
        status: EnvironmentReleaseStatus.SUCCESS,
        deletedAt: null,
      },
      include: releaseInclude,
      orderBy: [{ deployedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return row ? this.toPublic(row) : null;
  }

  async list(projectId: string, environmentId: string, limit = 30) {
    await this.assertEnvironment(projectId, environmentId);
    const rows = await this.prisma.environmentRelease.findMany({
      where: { projectId, environmentId, deletedAt: null },
      include: releaseInclude,
      orderBy: [{ deployedAt: 'desc' }, { createdAt: 'desc' }],
      take: Math.max(1, Math.min(limit, 100)),
    });
    return Promise.all(rows.map((row) => this.toPublic(row)));
  }

  async recordDeployment(
    projectId: string,
    environmentId: string,
    dto: CreateDeploymentDto,
    source: EnvironmentReleaseSource,
    suppliedIdempotencyKey?: string,
  ) {
    const environment = await this.assertEnvironment(projectId, environmentId);
    if (!environment.project.orgId) {
      throw new BadRequestException('Environment releases require an organisation-scoped project');
    }
    const orgId = environment.project.orgId;
    const inputs = normalizeComponentInputs(dto);
    const prepared = await Promise.all(
      inputs.map((component, index) => this.prepareComponent(
        projectId,
        environmentId,
        dto,
        component,
        index,
      )),
    );
    assertUniqueComponents(prepared);

    const version = dto.releaseVersion?.trim()
      || deriveReleaseVersion(prepared, dto.commitSha, dto.deployedAt);
    const deployedAt = dto.deployedAt ? new Date(dto.deployedAt) : new Date();
    const idempotencyKey = normalizeIdempotencyKey(
      suppliedIdempotencyKey,
      {
        projectId,
        environmentId,
        source,
        status: dto.status,
        version,
        deployedAt: dto.deployedAt ?? null,
        externalDeploymentId: dto.externalDeploymentId ?? null,
        commitSha: dto.commitSha ?? null,
        components: prepared,
      },
    );

    const existing = await this.prisma.environmentRelease.findUnique({
      where: { projectId_idempotencyKey: { projectId, idempotencyKey } },
      include: releaseInclude,
    });
    if (existing) return this.toPublic(existing);

    try {
      const release = await this.prisma.environmentRelease.create({
        data: {
          orgId,
          projectId,
          environmentId,
          version,
          source,
          status: dto.status,
          commitSha: clean(dto.commitSha),
          branch: clean(dto.branch),
          artifactDigest: clean(dto.artifactDigest),
          externalDeploymentId: clean(dto.externalDeploymentId),
          pipelineUrl: clean(dto.pipelineUrl),
          idempotencyKey,
          deployedAt,
          metadata: json(dto.metadata),
          components: {
            create: prepared.map((component) => ({
              orgId,
              projectId,
              projectRepoId: component.projectRepoId,
              componentKey: component.componentKey,
              componentName: component.componentName,
              version: component.version,
              commitSha: component.commitSha,
              branch: component.branch,
              artifactDigest: component.artifactDigest,
              manifestPath: component.manifestPath,
              metadata: json(component.metadata),
            })),
          },
        },
        include: releaseInclude,
      });
      return this.toPublic(release);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const duplicate = await this.prisma.environmentRelease.findUnique({
          where: { projectId_idempotencyKey: { projectId, idempotencyKey } },
          include: releaseInclude,
        });
        if (duplicate) return this.toPublic(duplicate);
      }
      throw error;
    }
  }

  async inferFromRepository(projectId: string, environmentId: string) {
    await this.assertEnvironment(projectId, environmentId);
    const bindings = await this.prisma.repoEnvBinding.findMany({
      where: {
        projectId,
        environmentId,
        deletedAt: null,
        projectRepo: { deletedAt: null },
      },
      include: { projectRepo: true },
      orderBy: { createdAt: 'asc' },
    });
    if (bindings.length === 0) {
      throw new BadRequestException('No repository branches are bound to this environment');
    }

    const components: DeploymentComponentDto[] = [];
    for (const binding of bindings) {
      const branches = await this.repos.listBranches(projectId, binding.projectRepoId);
      const head = branches.find((branch) => branch.name === binding.branch)?.sha;
      if (!head) continue;
      const resolved = await this.versions.resolve(binding, head);
      components.push({
        repoId: binding.projectRepoId,
        name: binding.componentName ?? defaultComponentName(
          binding.projectRepo.role,
          binding.projectRepo.repoName,
        ),
        commitSha: head,
        branch: binding.branch,
        version: resolved?.version ?? undefined,
        manifestPath: resolved?.manifestPath,
        metadata: resolved ? { manifestSha: resolved.manifestSha } : undefined,
      });
    }
    if (components.length === 0) {
      throw new BadRequestException('Could not resolve any bound repository branch heads');
    }
    if (!components.some((component) => component.version)) {
      throw new BadRequestException(
        'No version was found. Configure a manifest path or publish the version from CI.',
      );
    }
    return this.recordDeployment(
      projectId,
      environmentId,
      {
        status: EnvironmentReleaseStatus.SUCCESS,
        components,
        metadata: { inferred: true },
      },
      EnvironmentReleaseSource.REPO_INFERRED,
    );
  }

  async rotateGithubWebhook(projectId: string, repoId: string) {
    const repo = await this.prisma.projectRepo.findFirst({
      where: { id: repoId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!repo) throw new NotFoundException('Repository not found');
    const secret = randomBytes(32).toString('base64url');
    await this.prisma.projectRepo.update({
      where: { id: repo.id },
      data: { webhookSecret: secret },
    });
    return {
      secret,
      endpoint: `${apiUrl()}/api/v1/webhooks/github/deployments/${repo.id}`,
      events: ['deployment_status'],
    };
  }

  private async prepareComponent(
    projectId: string,
    environmentId: string,
    deployment: CreateDeploymentDto,
    input: DeploymentComponentDto,
    index: number,
  ): Promise<PreparedComponent> {
    const repo = input.repoId
      ? await this.prisma.projectRepo.findFirst({
          where: { id: input.repoId, projectId, deletedAt: null },
        })
      : null;
    if (input.repoId && !repo) {
      throw new BadRequestException(`Component repository does not belong to this project: ${input.repoId}`);
    }

    const commitSha = clean(input.commitSha) ?? clean(deployment.commitSha);
    const branch = clean(input.branch) ?? clean(deployment.branch);
    const binding = repo
      ? await this.prisma.repoEnvBinding.findFirst({
          where: {
            projectId,
            environmentId,
            projectRepoId: repo.id,
            deletedAt: null,
          },
        })
      : null;
    let resolved: ResolvedManifestVersion | null = null;
    if (!input.version && repo && binding && commitSha) {
      resolved = await this.versions.resolve(binding, commitSha);
    }
    const componentName = clean(input.name)
      ?? binding?.componentName
      ?? (repo ? defaultComponentName(repo.role, repo.repoName) : `Component ${index + 1}`);
    return {
      projectRepoId: repo?.id ?? null,
      componentKey: repo?.id ?? slug(componentName),
      componentName,
      version: clean(input.version) ?? resolved?.version ?? null,
      commitSha,
      branch: branch ?? binding?.branch ?? null,
      artifactDigest: clean(input.artifactDigest) ?? clean(deployment.artifactDigest),
      manifestPath: clean(input.manifestPath) ?? resolved?.manifestPath ?? null,
      metadata: input.metadata ?? (resolved ? { manifestSha: resolved.manifestSha } : null),
    };
  }

  private async assertEnvironment(projectId: string, environmentId: string) {
    const environment = await this.prisma.environment.findFirst({
      where: { id: environmentId, projectId, deletedAt: null },
      select: {
        id: true,
        project: { select: { id: true, orgId: true } },
      },
    });
    if (!environment) throw new NotFoundException('Environment not found in this project');
    return environment;
  }

  private async toPublic<T extends ReleaseWithRelations>(release: T) {
    const comparisons = await Promise.all(release.components.map(async (component) => {
      if (!component.projectRepoId || !component.branch || !component.commitSha) {
        return { componentId: component.id, indexedCommitSha: null, differsFromIndex: false };
      }
      const index = await this.prisma.repoBranchIndex.findFirst({
        where: {
          projectRepoId: component.projectRepoId,
          branch: component.branch,
          deletedAt: null,
        },
        select: { commitSha: true },
      });
      return {
        componentId: component.id,
        indexedCommitSha: index?.commitSha ?? null,
        differsFromIndex: Boolean(index?.commitSha && index.commitSha !== component.commitSha),
      };
    }));
    const comparisonById = new Map(comparisons.map((item) => [item.componentId, item]));
    return {
      ...release,
      components: release.components.map((component) => ({
        ...component,
        indexedCommitSha: comparisonById.get(component.id)?.indexedCommitSha ?? null,
        differsFromIndex: comparisonById.get(component.id)?.differsFromIndex ?? false,
      })),
      differsFromIndex: comparisons.some((item) => item.differsFromIndex),
    };
  }
}

const releaseInclude = {
  components: {
    where: { deletedAt: null },
    include: {
      projectRepo: {
        select: {
          id: true,
          role: true,
          repoOwner: true,
          repoName: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.EnvironmentReleaseInclude;

type ReleaseWithRelations = Prisma.EnvironmentReleaseGetPayload<{
  include: typeof releaseInclude;
}>;

function normalizeComponentInputs(dto: CreateDeploymentDto): DeploymentComponentDto[] {
  if (dto.components?.length) return dto.components;
  if (
    dto.repoId
    || dto.componentName
    || dto.version
    || dto.commitSha
    || dto.artifactDigest
  ) {
    return [{
      repoId: dto.repoId,
      name: dto.componentName,
      version: dto.version,
      commitSha: dto.commitSha,
      branch: dto.branch,
      artifactDigest: dto.artifactDigest,
    }];
  }
  return [];
}

function deriveReleaseVersion(
  components: PreparedComponent[],
  commitSha?: string,
  deployedAt?: string,
): string {
  const versions = [...new Set(
    components.map((component) => component.version).filter((value): value is string => Boolean(value)),
  )];
  if (versions.length === 1) return versions[0]!;
  const sha = clean(commitSha)
    ?? components.map((component) => component.commitSha).find((value): value is string => Boolean(value));
  if (sha) return `release-${sha.slice(0, 12)}`;
  const date = deployedAt ? new Date(deployedAt) : new Date();
  return `release-${date.toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14)}`;
}

function normalizeIdempotencyKey(
  supplied: string | undefined,
  payload: Record<string, unknown>,
): string {
  const value = supplied?.trim();
  if (value) {
    if (value.length > 200 || /[\r\n\0]/u.test(value)) {
      throw new BadRequestException('Idempotency-Key is invalid');
    }
    return `client:${value}`;
  }
  return `auto:${createHash('sha256').update(stableStringify(payload)).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function assertUniqueComponents(components: PreparedComponent[]): void {
  const keys = components.map((component) => component.componentKey);
  if (new Set(keys).size !== keys.length) {
    throw new BadRequestException('A release may contain each component only once');
  }
}

function defaultComponentName(role: RepoRole, repoName: string): string {
  const label: Record<RepoRole, string> = {
    FRONTEND: 'Frontend',
    BACKEND: 'Backend',
    INFRA: 'Infrastructure',
    OTHER: repoName,
  };
  return label[role];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'component';
}

function clean(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function json(value?: Record<string, unknown> | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value ? value as Prisma.InputJsonValue : Prisma.DbNull;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
