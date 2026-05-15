import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM secrets envelope.
 *
 * Layout of the stored ciphertext blob:
 *   [ IV (12) | authTag (16) | encryptedJSON (var) ]
 *
 * Plaintext is always a JSON object (Record<string,string>) — keeping the
 * shape stable means we never need a per-secret schema in the storage layer.
 *
 * KEK rotation: writes always use the current KEK + currentKeyId. Reads pick
 * a KEK by keyId — current OR previous — so a rotation can be staged by
 * setting both env vars, redeploying, then re-encrypting on next install
 * update at the caller's pace.
 *
 * Invariants enforced here:
 *   - Plaintext is NEVER logged
 *   - GCM auth tag is verified on every decrypt — tampering throws
 *   - KEK material is parsed once at boot; missing/bad KEK is a hard fail
 */
@Injectable()
export class SecretsService implements OnModuleInit {
  private readonly logger = new Logger(SecretsService.name);

  private currentKek!: Buffer;
  private currentKeyId!: string;
  private previousKek?: Buffer;
  private previousKeyId?: string;

  private static readonly IV_LEN = 12;
  private static readonly TAG_LEN = 16;

  onModuleInit(): void {
    const kek = process.env.SECRETS_KEK;
    if (!kek) {
      throw new Error('SECRETS_KEK env var required (32-byte key, hex or base64)');
    }
    this.currentKek = SecretsService.parseKek(kek);
    this.currentKeyId = process.env.SECRETS_KEK_KEY_ID ?? 'v1';

    const prev = process.env.SECRETS_KEK_PREVIOUS;
    if (prev) {
      this.previousKek = SecretsService.parseKek(prev);
      this.previousKeyId = process.env.SECRETS_KEK_PREVIOUS_KEY_ID ?? 'v0';
    }

    // Log key id only — never the key material.
    this.logger.log(
      `SecretsService initialised (currentKeyId=${this.currentKeyId}` +
        (this.previousKeyId ? `, previousKeyId=${this.previousKeyId}` : '') +
        ')',
    );
  }

  /** Encrypt with the current KEK. Returns a fresh blob + the keyId used. */
  encrypt(plaintext: Record<string, string>): { ciphertext: Buffer; keyId: string } {
    const iv = randomBytes(SecretsService.IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.currentKek, iv);
    const enc = Buffer.concat([
      cipher.update(JSON.stringify(plaintext), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: Buffer.concat([iv, tag, enc]),
      keyId: this.currentKeyId,
    };
  }

  /** Decrypt — picks the KEK matching `keyId`. Throws on tamper or unknown keyId. */
  decrypt(ciphertext: Buffer, keyId: string): Record<string, string> {
    const kek = this.kekFor(keyId);
    if (!kek) {
      throw new Error(`Unknown SECRETS_KEK keyId: ${keyId}`);
    }
    if (ciphertext.length < SecretsService.IV_LEN + SecretsService.TAG_LEN + 1) {
      throw new Error('Ciphertext blob malformed (too short)');
    }
    const iv = ciphertext.subarray(0, SecretsService.IV_LEN);
    const tag = ciphertext.subarray(
      SecretsService.IV_LEN,
      SecretsService.IV_LEN + SecretsService.TAG_LEN,
    );
    const enc = ciphertext.subarray(SecretsService.IV_LEN + SecretsService.TAG_LEN);

    const decipher = createDecipheriv('aes-256-gcm', kek, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);

    try {
      const parsed = JSON.parse(dec.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Decrypted plaintext is not a JSON object');
      }
      return parsed;
    } catch (err) {
      // Avoid leaking partial plaintext into the error.
      throw new Error('Decrypted plaintext failed to parse as JSON');
    }
  }

  /** Used on uninstall — overwrite the on-disk blob with a same-length zero buffer. */
  zeroBuffer(length: number): Buffer {
    return Buffer.alloc(length);
  }

  /** Whether two ciphertext blobs are byte-identical (constant-time). */
  static buffersEqualConstantTime(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private kekFor(keyId: string): Buffer | undefined {
    if (keyId === this.currentKeyId) return this.currentKek;
    if (this.previousKeyId && keyId === this.previousKeyId) return this.previousKek;
    return undefined;
  }

  private static parseKek(raw: string): Buffer {
    let buf: Buffer;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      buf = Buffer.from(raw, 'hex');
    } else {
      buf = Buffer.from(raw, 'base64');
    }
    if (buf.length !== 32) {
      throw new Error(
        `SECRETS_KEK must decode to exactly 32 bytes (got ${buf.length}); supply 64-char hex or base64-encoded 32 bytes`,
      );
    }
    return buf;
  }

  /** Test-only — re-init from explicit values. Never call in production code. */
  _initForTest(opts: {
    currentKek: Buffer;
    currentKeyId: string;
    previousKek?: Buffer;
    previousKeyId?: string;
  }): void {
    this.currentKek = opts.currentKek;
    this.currentKeyId = opts.currentKeyId;
    this.previousKek = opts.previousKek;
    this.previousKeyId = opts.previousKeyId;
  }
}
