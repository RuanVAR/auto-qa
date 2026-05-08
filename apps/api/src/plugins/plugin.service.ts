import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretsService } from './secrets.service';
import { pluginRegistry } from './registry';
import { buildPluginHttp } from './plugin.http';
import {
  PluginAuthError,
  PluginError,
  PluginNotEnabledError,
  PluginPermanentError,
  PluginTransientError,
} from './plugin.errors';
import type { PluginCapability, PluginCtx, PluginManifest } from './types';

/**
 * Owns the lifecycle of OrgPluginInstall rows + the dispatch hot path.
 *
 * Public surface:
 *   install        — write a new install row, encrypt secrets, run an initial healthCheck
 *   update         — patch config or secrets (re-encrypt if secrets changed)
 *   uninstall      — soft-delete + zero ciphertext (defence-in-depth, not a panic recover)
 *   healthCheck    — re-run the manifest's healthCheck and persist the result
 *   dispatch       — load the install, build ctx, call the capability handler, surface typed output
 *
 * Plaintext secrets exist only during dispatch() / install() calls; the value
 * is materialised on-stack and never assigned to instance state. Logging
 * goes through the Nest Logger and intentionally never includes ctx.secrets.
 */
@Injectable()
export class PluginService implements OnModuleDestroy {
  private readonly logger = new Logger(PluginService.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly config: ConfigService,
  ) {
    const url = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.redis = new Redis(url, { lazyConnect: false });
    this.redis.on('error', (e) => this.logger.error(`Redis error: ${e.message}`));
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  // ── install ───────────────────────────────────────────────────────────────

  async install(args: {
    orgId: string;
    pluginId: string;
    displayLabel?: string;
    config: unknown;
    secrets: Record<string, string>;
    installedById: string;
  }) {
    const manifest = pluginRegistry.get(args.pluginId);
    if (!manifest) throw new NotFoundException(`Unknown plugin: ${args.pluginId}`);

    const cfg = this.parseOrThrow(manifest.configSchema, args.config, 'config');
    const sec = this.parseOrThrow(manifest.secretsSchema, args.secrets, 'secrets');

    const { ciphertext, keyId } = this.secrets.encrypt(sec);

    const install = await this.prisma.orgPluginInstall.create({
      data: {
        orgId: args.orgId,
        pluginId: manifest.id,
        pluginVersion: manifest.version,
        displayLabel: args.displayLabel,
        config: cfg as Prisma.InputJsonValue,
        secretsCiphertext: ciphertext,
        secretsKeyId: keyId,
        installedById: args.installedById,
      },
    });

    // Run an initial healthCheck so the install lands with a real lastHealthOk.
    await this.healthCheck(install.id).catch((e) =>
      this.logger.warn(`Initial healthCheck failed for install ${install.id}: ${(e as Error).message}`),
    );

    return this.prisma.orgPluginInstall.findUniqueOrThrow({ where: { id: install.id } });
  }

  // ── update ────────────────────────────────────────────────────────────────

  async update(
    installId: string,
    patch: { config?: unknown; secrets?: Record<string, string>; displayLabel?: string | null; isEnabled?: boolean },
  ) {
    const install = await this.prisma.orgPluginInstall.findUnique({ where: { id: installId } });
    if (!install || install.deletedAt) throw new NotFoundException('Install not found');
    const manifest = pluginRegistry.require(install.pluginId);

    const data: Record<string, unknown> = {};
    if (patch.config !== undefined) {
      data.config = this.parseOrThrow(manifest.configSchema, patch.config, 'config') as Prisma.InputJsonValue;
    }
    if (patch.secrets !== undefined) {
      const sec = this.parseOrThrow(manifest.secretsSchema, patch.secrets, 'secrets');
      const { ciphertext, keyId } = this.secrets.encrypt(sec);
      data.secretsCiphertext = ciphertext;
      data.secretsKeyId = keyId;
    }
    if (patch.displayLabel !== undefined) data.displayLabel = patch.displayLabel;
    if (patch.isEnabled !== undefined) data.isEnabled = patch.isEnabled;

    return this.prisma.orgPluginInstall.update({ where: { id: installId }, data });
  }

  // ── uninstall ─────────────────────────────────────────────────────────────

  async uninstall(installId: string) {
    const install = await this.prisma.orgPluginInstall.findUnique({ where: { id: installId } });
    if (!install || install.deletedAt) throw new NotFoundException('Install not found');

    // Soft-delete + zero the ciphertext on disk. The KEK is operator-controlled
    // so this isn't a guarantee against forensic recovery, just defence-in-depth
    // against accidental disclosure of the encrypted blob.
    await this.prisma.orgPluginInstall.update({
      where: { id: installId },
      data: {
        deletedAt: new Date(),
        isEnabled: false,
        secretsCiphertext: this.secrets.zeroBuffer(install.secretsCiphertext.length),
      },
    });
  }

  // ── healthCheck ───────────────────────────────────────────────────────────

  async healthCheck(installId: string) {
    const install = await this.prisma.orgPluginInstall.findUnique({ where: { id: installId } });
    if (!install || install.deletedAt) throw new NotFoundException('Install not found');
    const manifest = pluginRegistry.require(install.pluginId);

    // healthCheck runs at the org-install scope — no binding config to merge in.
    const ctx = await this.buildCtx(install, manifest, install.config as unknown);
    let result: { ok: boolean; error?: string; connectedAs?: string };
    try {
      result = await manifest.healthCheck(ctx);
    } catch (err) {
      result = { ok: false, error: (err as Error).message };
    }

    const previouslyOk = install.lastHealthOk;
    await this.prisma.orgPluginInstall.update({
      where: { id: installId },
      data: {
        lastHealthOk: result.ok,
        lastHealthAt: new Date(),
        lastHealthError: result.error ?? null,
      },
    });

    if (previouslyOk !== result.ok) {
      // Health flip — caller may emit PLUGIN_HEALTH_DEGRADED notification.
      this.logger.log(
        `Plugin install ${installId} (${install.pluginId}) health flipped: ${previouslyOk} → ${result.ok}`,
      );
    }
    return result;
  }

  // ── dispatch ──────────────────────────────────────────────────────────────

  /**
   * Run a single capability call against an install. Returns the typed output.
   * Throws PluginNotEnabledError if the manifest doesn't declare the capability.
   *
   * The caller is responsible for any 4-level enablement gating (use
   * EnablementService for that). dispatch() trusts that the install passed in
   * is the right one.
   */
  async dispatch<TOut = unknown>(
    capability: PluginCapability,
    installId: string,
    payload: unknown,
    /** Resolved effective binding config for this scope — passed into ctx.config. */
    effectiveBindingConfig: unknown = {},
  ): Promise<TOut> {
    const install = await this.prisma.orgPluginInstall.findUnique({ where: { id: installId } });
    if (!install || install.deletedAt || !install.isEnabled) {
      throw new PluginNotEnabledError(install?.pluginId ?? '?', capability, `install:${installId}`);
    }
    const manifest = pluginRegistry.require(install.pluginId);
    if (!manifest.capabilities.includes(capability)) {
      throw new PluginNotEnabledError(install.pluginId, capability, `install:${installId}`);
    }
    const handler = manifest.handlers[capability];
    if (!handler) {
      throw new PluginNotEnabledError(install.pluginId, capability, `install:${installId}`);
    }

    const ctx = await this.buildCtx(install, manifest, effectiveBindingConfig);
    try {
      return (await handler(ctx, payload)) as TOut;
    } catch (err) {
      if (err instanceof PluginAuthError) {
        // Credentials look bad — flip install to unhealthy.
        await this.prisma.orgPluginInstall
          .update({
            where: { id: installId },
            data: { lastHealthOk: false, lastHealthError: err.message, lastHealthAt: new Date() },
          })
          .catch(() => undefined);
      }
      throw err;
    }
  }

  // ── ctx builder ───────────────────────────────────────────────────────────

  private async buildCtx<C, S extends Record<string, string>>(
    install: { id: string; orgId: string; pluginId: string; pluginVersion: string; secretsCiphertext: Buffer; secretsKeyId: string },
    manifest: PluginManifest<C, S>,
    effectiveConfig: unknown,
  ): Promise<PluginCtx<C, S>> {
    const secrets = this.secrets.decrypt(install.secretsCiphertext, install.secretsKeyId) as S;
    // Default auth header: many APIs accept the raw token in Authorization,
    // but plugins MAY override by mutating the http instance in their handler.
    const http = buildPluginHttp({
      authHeader: secrets.apiToken ?? '',
      pluginId: install.pluginId,
      orgId: install.orgId,
      rateLimitPerMinute: manifest.rateLimit?.perMinute,
      redis: this.redis,
    });
    return {
      orgId: install.orgId,
      installId: install.id,
      pluginId: install.pluginId,
      pluginVersion: install.pluginVersion,
      http,
      secrets,
      config: effectiveConfig as C,
      logger: new Logger(`Plugin:${install.pluginId}`),
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private parseOrThrow<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { message: string } } }, value: unknown, what: string): T {
    const r = schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException(`Invalid ${what}: ${r.error?.message ?? 'unknown error'}`);
    }
    return r.data as T;
  }
}
