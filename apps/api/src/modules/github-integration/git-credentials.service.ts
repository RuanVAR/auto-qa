import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  private readonly logger = new Logger(GitCredentialsService.name);

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
    const existing = await this.current(orgId);

    const { ciphertext, keyId } = this.resolveSecret(input, existing);

    const data = {
      provider: input.provider ?? existing?.provider ?? GitProvider.GITHUB,
      authKind: input.authKind,
      displayLabel: input.displayLabel ?? existing?.displayLabel ?? null,
      baseUrl: input.baseUrl ?? existing?.baseUrl ?? null,
      appInstallationId: input.appInstallationId ?? existing?.appInstallationId ?? null,
      secretsCiphertext: ciphertext,
      secretsKeyId: keyId,
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
    // Hard delete — cascades ProjectRepo (a repo can't outlive its credential).
    await this.prisma.orgGitCredential.delete({ where: { id: row.id } }).catch(() => undefined);
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
    if (!row) return null;
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
    } else {
      if (input.privateKey && input.privateKey !== MASKED) {
        if (!input.appId) throw new BadRequestException('appId is required when setting an App private key');
        return this.secrets.encrypt({ appId: input.appId, privateKey: input.privateKey });
      }
    }
    if (existing) return { ciphertext: existing.secretsCiphertext, keyId: existing.secretsKeyId };
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
