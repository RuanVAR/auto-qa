import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GitAuthKind, GitProvider, OrgGitCredential, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretsService } from '../../common/secrets/secrets.service';
import { GitAuth, GitHubClient } from './github.client';

const MASKED = '••••••••';

export interface PublicGitCredential {
  id: string;
  provider: GitProvider;
  authKind: GitAuthKind;
  displayLabel: string | null;
  baseUrl: string | null;
  appInstallationId: string | null;
  connectedAs: string | null;
  lastHealthOk: boolean;
  lastHealthAt: Date | null;
  lastHealthError: string | null;
  isEnabled: boolean;
  /** True when a secret is on file — the secret itself is never returned. */
  hasSecret: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertGitCredentialInput {
  authKind: GitAuthKind;
  provider?: GitProvider;
  displayLabel?: string;
  baseUrl?: string;
  // PAT
  token?: string | null; // MASKED / null = keep existing
  // APP
  appId?: string;
  privateKey?: string | null; // MASKED / null = keep existing
  appInstallationId?: string;
}

/**
 * Owns the org-level GitHub credential lifecycle. One credential per org for
 * now (multi-credential via displayLabel is left for later). Secrets go through
 * SecretsService; the controller never sees plaintext. A successful write or an
 * explicit test refreshes the cached health (lastHealthOk / connectedAs).
 */
@Injectable()
export class GitCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly github: GitHubClient,
  ) {}

  private current(orgId: string) {
    return this.prisma.orgGitCredential.findFirst({ where: { orgId, deletedAt: null } });
  }

  async getMasked(orgId: string): Promise<PublicGitCredential | null> {
    const row = await this.current(orgId);
    return row ? toPublic(row) : null;
  }

  async upsert(orgId: string, userId: string, input: UpsertGitCredentialInput): Promise<PublicGitCredential> {
    const active = await this.current(orgId);
    const normalised = normaliseCredentialInput(input, active);
    const archived = active
      ? null
      : await this.prisma.orgGitCredential.findFirst({
          where: {
            orgId,
            provider: normalised.provider,
            displayLabel: normalised.displayLabel,
            deletedAt: { not: null },
          },
          orderBy: { updatedAt: 'desc' },
        });
    const existing = active ?? archived;

    const { ciphertext, keyId } = this.resolveSecret(normalised, active);

    const data = {
      provider: normalised.provider,
      authKind: normalised.authKind,
      displayLabel: normalised.displayLabel ?? null,
      baseUrl: normalised.baseUrl ?? null,
      appInstallationId: normalised.appInstallationId ?? null,
      secretsCiphertext: ciphertext,
      secretsKeyId: keyId,
      isEnabled: true,
      deletedAt: null,
    } satisfies Prisma.OrgGitCredentialUncheckedUpdateInput;

    const row = existing
      ? await this.prisma.orgGitCredential.update({ where: { id: existing.id }, data })
      : await this.prisma.orgGitCredential.create({
          data: { ...data, orgId, createdById: userId } as Prisma.OrgGitCredentialUncheckedCreateInput,
        });

    // Refresh health on every write so the UI reflects reality immediately.
    return this.runHealth(row.id);
  }

  async remove(orgId: string): Promise<void> {
    const row = await this.current(orgId);
    if (!row) return;
    const repos = await this.prisma.projectRepo.findMany({
      where: { credentialId: row.id, deletedAt: null },
      select: { id: true, secretsCiphertext: true },
    });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const repo of repos) {
        await tx.projectRepo.update({
          where: { id: repo.id },
          data: {
            deletedAt: now,
            secretsCiphertext: repo.secretsCiphertext
              ? this.secrets.zeroBuffer(repo.secretsCiphertext.length)
              : null,
            secretsKeyId: null,
            webhookSecret: null,
            webhookExternalId: null,
          },
        });
      }
      await tx.orgGitCredential.update({
        where: { id: row.id },
        data: {
          deletedAt: now,
          isEnabled: false,
          lastHealthOk: false,
          secretsCiphertext: this.secrets.zeroBuffer(row.secretsCiphertext.length),
        },
      });
    });
  }

  /** Run a live health probe against the stored credential and cache the result. */
  async test(orgId: string): Promise<PublicGitCredential> {
    const row = await this.current(orgId);
    if (!row) throw new NotFoundException('No GitHub credential configured for this org');
    return this.runHealth(row.id);
  }

  /** Resolve decrypted auth for a stored credential — used by the repos service. */
  async authForOrg(orgId: string): Promise<{ credentialId: string; auth: GitAuth } | null> {
    const row = await this.current(orgId);
    if (!row?.isEnabled) return null;
    return { credentialId: row.id, auth: this.authFromRow(row) };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private resolveSecret(
    input: UpsertGitCredentialInput,
    existing: OrgGitCredential | null,
  ): { ciphertext: Buffer; keyId: string } {
    if (input.authKind === GitAuthKind.PAT) {
      if (input.token && input.token !== MASKED) {
        return this.secrets.encrypt({ token: input.token });
      }
      if (existing?.authKind === GitAuthKind.PAT) {
        return { ciphertext: existing.secretsCiphertext, keyId: existing.secretsKeyId };
      }
    } else {
      if (input.privateKey && input.privateKey !== MASKED) {
        const prior = existing?.authKind === GitAuthKind.APP
          ? this.secrets.decrypt(existing.secretsCiphertext, existing.secretsKeyId)
          : null;
        const appId = input.appId ?? prior?.appId;
        if (!appId) throw new BadRequestException('appId is required when setting an App private key');
        return this.secrets.encrypt({ appId, privateKey: input.privateKey });
      }
      if (existing?.authKind === GitAuthKind.APP) {
        const prior = this.secrets.decrypt(existing.secretsCiphertext, existing.secretsKeyId);
        if (input.appId && input.appId !== prior.appId) {
          return this.secrets.encrypt({ appId: input.appId, privateKey: prior.privateKey });
        }
        return { ciphertext: existing.secretsCiphertext, keyId: existing.secretsKeyId };
      }
    }
    throw new BadRequestException(
      input.authKind === GitAuthKind.PAT
        ? 'token is required when configuring GitHub for the first time'
        : 'appId + privateKey are required when configuring a GitHub App',
    );
  }

  private authFromRow(row: OrgGitCredential): GitAuth {
    const s = this.secrets.decrypt(row.secretsCiphertext, row.secretsKeyId);
    if (row.authKind === GitAuthKind.PAT) {
      return { kind: 'PAT', token: s.token, baseUrl: row.baseUrl };
    }
    return {
      kind: 'APP',
      appId: s.appId,
      privateKey: s.privateKey,
      installationId: row.appInstallationId,
      baseUrl: row.baseUrl,
    };
  }

  private async runHealth(id: string): Promise<PublicGitCredential> {
    const row = await this.prisma.orgGitCredential.findUniqueOrThrow({ where: { id } });
    const health = await this.github.health(this.authFromRow(row));
    const updated = await this.prisma.orgGitCredential.update({
      where: { id },
      data: {
        lastHealthOk: health.ok,
        lastHealthAt: new Date(),
        lastHealthError: health.ok ? null : (health.error ?? 'health check failed'),
        connectedAs: health.connectedAs ?? row.connectedAs,
      },
    });
    return toPublic(updated);
  }
}

function normaliseCredentialInput(
  input: UpsertGitCredentialInput,
  existing: OrgGitCredential | null,
): Required<Pick<UpsertGitCredentialInput, 'authKind' | 'provider'>>
  & Omit<UpsertGitCredentialInput, 'authKind' | 'provider'> {
  const provider = input.provider ?? existing?.provider ?? GitProvider.GITHUB;
  if (provider === GitProvider.GITLAB) {
    throw new BadRequestException('GitLab credentials are not supported by the GitHub integration');
  }

  let baseUrl: string | null = null;
  if (provider === GitProvider.GITHUB_ENTERPRISE) {
    if (!input.baseUrl && !existing?.baseUrl) {
      throw new BadRequestException('baseUrl is required for GitHub Enterprise');
    }
    let parsed: URL;
    try {
      parsed = new URL(input.baseUrl ?? existing?.baseUrl ?? '');
    } catch {
      throw new BadRequestException('GitHub Enterprise baseUrl is invalid');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('GitHub Enterprise baseUrl must use http or https');
    }
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      throw new BadRequestException('GitHub Enterprise baseUrl must use https in production');
    }
    parsed.username = '';
    parsed.password = '';
    baseUrl = parsed.toString().replace(/\/$/, '');
  } else if (input.baseUrl) {
    throw new BadRequestException('baseUrl is only valid for GitHub Enterprise');
  }

  const appInstallationId = input.authKind === GitAuthKind.APP
    ? (input.appInstallationId ?? (existing?.authKind === GitAuthKind.APP ? existing.appInstallationId ?? undefined : undefined))
    : undefined;
  if (input.authKind === GitAuthKind.APP && !appInstallationId) {
    throw new BadRequestException('appInstallationId is required for GitHub App authentication');
  }

  return {
    ...input,
    provider,
    displayLabel: input.displayLabel?.trim() || existing?.displayLabel || undefined,
    baseUrl: baseUrl ?? undefined,
    appInstallationId,
  };
}

function toPublic(row: OrgGitCredential): PublicGitCredential {
  return {
    id: row.id,
    provider: row.provider,
    authKind: row.authKind,
    displayLabel: row.displayLabel,
    baseUrl: row.baseUrl,
    appInstallationId: row.appInstallationId,
    connectedAs: row.connectedAs,
    lastHealthOk: row.lastHealthOk,
    lastHealthAt: row.lastHealthAt,
    lastHealthError: row.lastHealthError,
    isEnabled: row.isEnabled,
    hasSecret: row.secretsCiphertext.length > 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
