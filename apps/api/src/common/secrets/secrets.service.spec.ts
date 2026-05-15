import { randomBytes } from 'node:crypto';
import { SecretsService } from './secrets.service';

const newKek = () => randomBytes(32);

const buildSvc = (opts: {
  currentKek: Buffer;
  currentKeyId: string;
  previousKek?: Buffer;
  previousKeyId?: string;
}) => {
  const svc = new SecretsService();
  svc._initForTest(opts);
  return svc;
};

describe('SecretsService', () => {
  describe('round-trip', () => {
    it('encrypt → decrypt returns the original plaintext', () => {
      const svc = buildSvc({ currentKek: newKek(), currentKeyId: 'v1' });
      const plaintext = { apiToken: 'pk_live_abc123', userEmail: 'qa@example.com' };
      const { ciphertext, keyId } = svc.encrypt(plaintext);
      expect(keyId).toBe('v1');
      expect(svc.decrypt(ciphertext, keyId)).toEqual(plaintext);
    });

    it('produces a different ciphertext on each call (fresh IV)', () => {
      const svc = buildSvc({ currentKek: newKek(), currentKeyId: 'v1' });
      const plaintext = { apiToken: 'same' };
      const a = svc.encrypt(plaintext);
      const b = svc.encrypt(plaintext);
      expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
      // Both still decrypt to the same plaintext.
      expect(svc.decrypt(a.ciphertext, a.keyId)).toEqual(plaintext);
      expect(svc.decrypt(b.ciphertext, b.keyId)).toEqual(plaintext);
    });

    it('round-trips empty / unicode / long values', () => {
      const svc = buildSvc({ currentKek: newKek(), currentKeyId: 'v1' });
      const plaintext = {
        empty: '',
        unicode: '🔐 ✨ café — naïve',
        long: 'x'.repeat(8192),
      };
      const { ciphertext, keyId } = svc.encrypt(plaintext);
      expect(svc.decrypt(ciphertext, keyId)).toEqual(plaintext);
    });
  });

  describe('tamper detection', () => {
    it('throws when the ciphertext byte is flipped', () => {
      const svc = buildSvc({ currentKek: newKek(), currentKeyId: 'v1' });
      const { ciphertext, keyId } = svc.encrypt({ apiToken: 'secret' });
      // Flip a byte in the encrypted body (after IV+tag).
      const tampered = Buffer.from(ciphertext);
      tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 0xff;
      expect(() => svc.decrypt(tampered, keyId)).toThrow();
    });

    it('throws when the auth tag is mutated', () => {
      const svc = buildSvc({ currentKek: newKek(), currentKeyId: 'v1' });
      const { ciphertext, keyId } = svc.encrypt({ apiToken: 'secret' });
      // Tag lives at bytes 12..27 (IV_LEN..IV_LEN+TAG_LEN).
      const tampered = Buffer.from(ciphertext);
      tampered[14] = tampered[14] ^ 0x01;
      expect(() => svc.decrypt(tampered, keyId)).toThrow();
    });

    it('throws when the IV is mutated', () => {
      const svc = buildSvc({ currentKek: newKek(), currentKeyId: 'v1' });
      const { ciphertext, keyId } = svc.encrypt({ apiToken: 'secret' });
      const tampered = Buffer.from(ciphertext);
      tampered[2] = tampered[2] ^ 0x01;
      expect(() => svc.decrypt(tampered, keyId)).toThrow();
    });

    it('throws on a malformed (too-short) ciphertext', () => {
      const svc = buildSvc({ currentKek: newKek(), currentKeyId: 'v1' });
      expect(() => svc.decrypt(Buffer.alloc(8), 'v1')).toThrow(/malformed/);
    });
  });

  describe('KEK rotation', () => {
    it('blob written under the previous KEK still decrypts after rotation', () => {
      const oldKek = newKek();
      const newKekBuf = newKek();
      // Old service holds only oldKek as current
      const oldSvc = buildSvc({ currentKek: oldKek, currentKeyId: 'v1' });
      const { ciphertext } = oldSvc.encrypt({ apiToken: 'rotate-me' });

      // After rotation: newKek is current, oldKek is previous.
      const rotatedSvc = buildSvc({
        currentKek: newKekBuf,
        currentKeyId: 'v2',
        previousKek: oldKek,
        previousKeyId: 'v1',
      });

      // Read with the keyId that was stored when the blob was written.
      expect(rotatedSvc.decrypt(ciphertext, 'v1')).toEqual({ apiToken: 'rotate-me' });
      // New writes use the new keyId.
      const fresh = rotatedSvc.encrypt({ apiToken: 'fresh' });
      expect(fresh.keyId).toBe('v2');
      expect(rotatedSvc.decrypt(fresh.ciphertext, fresh.keyId)).toEqual({ apiToken: 'fresh' });
    });

    it('throws when decrypting under an unknown keyId', () => {
      const svc = buildSvc({ currentKek: newKek(), currentKeyId: 'v1' });
      const { ciphertext } = svc.encrypt({ apiToken: 'x' });
      expect(() => svc.decrypt(ciphertext, 'v99')).toThrow(/Unknown SECRETS_KEK keyId/);
    });

    it('throws when the wrong (but registered) KEK is used', () => {
      // Encrypt under v1, then re-init the service with a different v1 KEK.
      const realKek = newKek();
      const decoy = newKek();
      const svc = buildSvc({ currentKek: realKek, currentKeyId: 'v1' });
      const { ciphertext } = svc.encrypt({ apiToken: 'secret' });
      svc._initForTest({ currentKek: decoy, currentKeyId: 'v1' });
      expect(() => svc.decrypt(ciphertext, 'v1')).toThrow();
    });
  });

  describe('zeroBuffer', () => {
    it('returns an all-zero buffer of the requested length', () => {
      const svc = buildSvc({ currentKek: newKek(), currentKeyId: 'v1' });
      const z = svc.zeroBuffer(64);
      expect(z.length).toBe(64);
      expect(z.every((b) => b === 0)).toBe(true);
    });
  });
});
