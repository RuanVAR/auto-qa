import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM secrets envelope — shared between the API (encrypt) and the
 * worker (decrypt) so per-environment credentials and encrypted env variables
 * can be written by one service and read by the other.
 *
 * Layout (identical to apps/api SecretsService so the formats interoperate):
 *   [ IV (12) | authTag (16) | encryptedJSON (var) ]
 *
 * KEK material comes from env: SECRETS_KEK (32 bytes, hex or base64), optional
 * SECRETS_KEK_PREVIOUS for staged rotation. Plaintext is always a JSON object.
 * Parsed once, lazily, and cached — both backend services already hold the KEK.
 */

const IV_LEN = 12;
const TAG_LEN = 16;

interface KekState {
  currentKek: Buffer;
  currentKeyId: string;
  previousKek?: Buffer;
  previousKeyId?: string;
}

let cached: KekState | null = null;

function parseKek(raw: string): Buffer {
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`SECRETS_KEK must decode to exactly 32 bytes (got ${buf.length}); supply 64-char hex or base64-encoded 32 bytes`);
  }
  return buf;
}

function loadKek(): KekState {
  if (cached) return cached;
  const kek = process.env.SECRETS_KEK;
  if (!kek) throw new Error('SECRETS_KEK env var required (32-byte key, hex or base64)');
  const state: KekState = {
    currentKek: parseKek(kek),
    currentKeyId: process.env.SECRETS_KEK_KEY_ID ?? 'v1',
  };
  const prev = process.env.SECRETS_KEK_PREVIOUS;
  if (prev) {
    state.previousKek = parseKek(prev);
    state.previousKeyId = process.env.SECRETS_KEK_PREVIOUS_KEY_ID ?? 'v0';
  }
  cached = state;
  return state;
}

function kekFor(keyId: string, s: KekState): Buffer | undefined {
  if (keyId === s.currentKeyId) return s.currentKek;
  if (s.previousKeyId && keyId === s.previousKeyId) return s.previousKek;
  return undefined;
}

/** Encrypt a JSON object with the current KEK. Returns the blob + keyId used. */
export function encryptSecret(plaintext: Record<string, string>): { ciphertext: Buffer; keyId: string } {
  const s = loadKek();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', s.currentKek, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([iv, tag, enc]), keyId: s.currentKeyId };
}

/** Decrypt a blob produced by encryptSecret. Throws on tamper / unknown keyId. */
export function decryptSecret(ciphertext: Buffer, keyId: string): Record<string, string> {
  const s = loadKek();
  const kek = kekFor(keyId, s);
  if (!kek) throw new Error(`Unknown SECRETS_KEK keyId: ${keyId}`);
  if (ciphertext.length < IV_LEN + TAG_LEN + 1) throw new Error('Ciphertext blob malformed (too short)');
  const iv = ciphertext.subarray(0, IV_LEN);
  const tag = ciphertext.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = ciphertext.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  const parsed = JSON.parse(dec.toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Decrypted plaintext is not a JSON object');
  }
  return parsed as Record<string, string>;
}

/** Test-only — inject KEK state without env vars. */
export function _setKekForTest(state: KekState): void {
  cached = state;
}
