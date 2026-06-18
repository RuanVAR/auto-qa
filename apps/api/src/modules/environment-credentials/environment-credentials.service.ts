import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { encryptSecret } from '@qa-platform/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Named, encrypted login credentials scoped to an environment (Phase 5c).
 *
 * A credential is a JSON map of fields (e.g. { EMAIL, PASSWORD }) encrypted at
 * rest via the shared AES-256-GCM box. The worker decrypts at run start and
 * injects each field as a {{NAME_FIELD}} variable. Secret values are NEVER
 * returned by the API — reads expose only the credential name + field keys.
 */
@Injectable()
export class EnvironmentCredentialsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertEnv(environmentId: string) {
    const env = await this.prisma.environment.findFirst({
      where: { id: environmentId, deletedAt: null },
      select: { id: true },
    });
    if (!env) throw new NotFoundException('Environment not found');
  }

  /** List credentials for an env — names + field keys only, never values. */
  async list(environmentId: string) {
    await this.assertEnv(environmentId);
    const rows = await this.prisma.environmentCredential.findMany({
      where: { environmentId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, secretsCiphertext: true, secretsKeyId: true, updatedAt: true },
    });
    // Surface field keys (not values) so the UI can show what a credential
    // holds. We avoid decrypting here by storing field keys is overkill — just
    // decrypt and drop the values.
    return rows.map((r) => {
      let fields: string[] = [];
      try {
        const { decryptSecret } = require('@qa-platform/shared') as typeof import('@qa-platform/shared');
        fields = Object.keys(decryptSecret(Buffer.from(r.secretsCiphertext), r.secretsKeyId));
      } catch {
        fields = [];
      }
      return { id: r.id, name: r.name, fields, updatedAt: r.updatedAt };
    });
  }

  /** Create or replace a named credential. `fields` is the plaintext map. */
  async upsert(
    environmentId: string,
    name: string,
    fields: Record<string, string>,
    userId?: string,
  ) {
    await this.assertEnv(environmentId);
    const cleanName = (name ?? '').trim();
    if (!cleanName) throw new BadRequestException('Credential name is required');
    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new BadRequestException('At least one field (e.g. EMAIL, PASSWORD) is required');
    }
    // Normalise field keys to UPPER_SNAKE so the injected token is predictable
    // ({{LOGIN_EMAIL}} etc.). Values are kept verbatim.
    const normalised: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      const key = k.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (key) normalised[key] = String(v);
    }
    const { ciphertext, keyId } = encryptSecret(normalised);
    const row = await this.prisma.environmentCredential.upsert({
      where: { environmentId_name: { environmentId, name: cleanName } },
      create: { environmentId, name: cleanName, secretsCiphertext: ciphertext, secretsKeyId: keyId, createdById: userId },
      update: { secretsCiphertext: ciphertext, secretsKeyId: keyId },
      select: { id: true, name: true, updatedAt: true },
    });
    return { ...row, fields: Object.keys(normalised) };
  }

  async remove(environmentId: string, name: string) {
    await this.assertEnv(environmentId);
    await this.prisma.environmentCredential.deleteMany({ where: { environmentId, name } });
    return { ok: true };
  }
}
