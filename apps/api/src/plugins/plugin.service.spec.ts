import { z } from 'zod';

// Stub ioredis at module level — PluginService opens a real client in its
// constructor, which blows up under jest with "NOAUTH" / unconnectable hosts.
jest.mock('ioredis', () => {
  const Mock = jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue(undefined),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  }));
  return { __esModule: true, default: Mock };
});

import { PluginService } from './plugin.service';
import { SecretsService } from './secrets.service';
import { pluginRegistry } from './registry';
import {
  PluginAuthError,
  PluginNotEnabledError,
  PluginPermanentError,
} from './plugin.errors';
import type { PluginManifest } from './types';

/**
 * Unit tests for the dispatch hot path + lifecycle. We mock Prisma + the
 * SecretsService dependency directly — there's no DB or Redis here. The plugin
 * registry is restored to a known state at the start of every test.
 */
describe('PluginService', () => {
  // ── Test plugin manifest factories ────────────────────────────────────────
  const okHealth = jest.fn(async () => ({ ok: true, connectedAs: 'test-user' }));
  const dispatchHandler = jest.fn(async () => ({ externalId: 'task-1' }));

  const buildManifest = (
    overrides: Partial<PluginManifest> = {},
  ): PluginManifest => ({
    id: 'echo',
    name: 'Echo',
    description: 'test plugin',
    version: '1.0.0',
    capabilities: ['createIssue'],
    configSchema: z.object({}).strict(),
    secretsSchema: z.object({ apiToken: z.string() }).strict() as never,
    healthCheck: okHealth,
    handlers: { createIssue: dispatchHandler },
    ...overrides,
  });

  // ── Mock infrastructure ───────────────────────────────────────────────────
  type MockPrisma = {
    orgPluginInstall: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
  };

  const mkPrisma = (): MockPrisma => ({
    orgPluginInstall: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
  });

  const mkSvc = () => {
    const prisma = mkPrisma();
    const secrets = new SecretsService();
    secrets._initForTest({ currentKek: Buffer.alloc(32, 7), currentKeyId: 'v1' });
    const config = { get: jest.fn().mockReturnValue('redis://localhost:6379') } as unknown as ConstructorParameters<typeof PluginService>[2];
    const svc = new PluginService(prisma as never, secrets, config);
    // Replace the real Redis with a no-op so tests don't open a connection.
    (svc as unknown as { redis: { quit: () => Promise<void>; on: () => void } }).redis = {
      quit: () => Promise.resolve(),
      on: () => undefined,
    };
    return { svc, prisma, secrets };
  };

  beforeEach(() => {
    pluginRegistry._resetForTest();
    pluginRegistry.register(buildManifest());
    okHealth.mockClear();
    dispatchHandler.mockClear();
  });

  afterAll(() => pluginRegistry._resetForTest());

  // ── install ──────────────────────────────────────────────────────────────
  describe('install', () => {
    it('encrypts secrets, persists install, runs initial healthcheck', async () => {
      const { svc, prisma } = mkSvc();
      let stored: { secretsCiphertext: Buffer; secretsKeyId: string; isEnabled: boolean; lastHealthOk: boolean } = {
        secretsCiphertext: Buffer.alloc(0),
        secretsKeyId: '',
        isEnabled: true,
        lastHealthOk: false,
      };
      prisma.orgPluginInstall.create.mockImplementation(({ data }: { data: typeof stored & Record<string, unknown> }) => {
        stored = { ...stored, ...data, lastHealthOk: false };
        return Promise.resolve({ id: 'inst-1', orgId: 'org-1', pluginId: 'echo', pluginVersion: '1.0.0', config: {}, ...stored });
      });
      // Use mockImplementation so the closure reads the *current* stored
      // object whenever findUnique runs (after create has populated it).
      prisma.orgPluginInstall.findUnique.mockImplementation(() =>
        Promise.resolve({ id: 'inst-1', orgId: 'org-1', pluginId: 'echo', pluginVersion: '1.0.0', config: {}, deletedAt: null, ...stored }),
      );
      prisma.orgPluginInstall.findUniqueOrThrow.mockImplementation(() =>
        Promise.resolve({ id: 'inst-1', orgId: 'org-1', pluginId: 'echo', pluginVersion: '1.0.0', config: {}, ...stored }),
      );
      prisma.orgPluginInstall.update.mockResolvedValue({});

      await svc.install({
        orgId: 'org-1',
        pluginId: 'echo',
        config: {},
        secrets: { apiToken: 'pk_secret' },
        installedById: 'user-1',
      });

      expect(prisma.orgPluginInstall.create).toHaveBeenCalled();
      expect(stored.secretsCiphertext).not.toEqual(Buffer.from('pk_secret', 'utf8'));
      expect(stored.secretsCiphertext.length).toBeGreaterThan(28); // IV(12)+tag(16)+payload
      expect(stored.secretsKeyId).toBe('v1');
      expect(okHealth).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException on invalid secrets schema', async () => {
      const { svc } = mkSvc();
      await expect(
        svc.install({ orgId: 'o', pluginId: 'echo', config: {}, secrets: {} as never, installedById: 'u' }),
      ).rejects.toThrow(/Invalid secrets/);
    });
  });

  // ── update ───────────────────────────────────────────────────────────────
  describe('update', () => {
    it('re-encrypts when secrets are patched', async () => {
      const { svc, prisma, secrets } = mkSvc();
      const { ciphertext, keyId } = secrets.encrypt({ apiToken: 'orig' });
      prisma.orgPluginInstall.findUnique.mockResolvedValue({
        id: 'i1', pluginId: 'echo', deletedAt: null, secretsCiphertext: ciphertext, secretsKeyId: keyId,
      });
      prisma.orgPluginInstall.update.mockImplementation(({ data }: { data: { secretsCiphertext?: Buffer } }) => Promise.resolve({ id: 'i1', ...data }));

      await svc.update('i1', { secrets: { apiToken: 'rotated' } });

      const updateCall = prisma.orgPluginInstall.update.mock.calls[0][0] as { data: { secretsCiphertext: Buffer; secretsKeyId: string } };
      expect(updateCall.data.secretsCiphertext).toBeInstanceOf(Buffer);
      expect(updateCall.data.secretsCiphertext.equals(ciphertext)).toBe(false);
      expect(secrets.decrypt(updateCall.data.secretsCiphertext, updateCall.data.secretsKeyId)).toEqual({ apiToken: 'rotated' });
    });
  });

  // ── uninstall ────────────────────────────────────────────────────────────
  describe('uninstall', () => {
    it('soft-deletes + zeros the ciphertext (same length, all zeros)', async () => {
      const { svc, prisma, secrets } = mkSvc();
      const { ciphertext } = secrets.encrypt({ apiToken: 'x' });
      prisma.orgPluginInstall.findUnique.mockResolvedValue({
        id: 'i1', pluginId: 'echo', deletedAt: null, secretsCiphertext: ciphertext, secretsKeyId: 'v1',
      });
      prisma.orgPluginInstall.update.mockResolvedValue({});

      await svc.uninstall('i1');

      const call = prisma.orgPluginInstall.update.mock.calls[0][0] as { data: { deletedAt: Date; secretsCiphertext: Buffer; isEnabled: boolean } };
      expect(call.data.deletedAt).toBeInstanceOf(Date);
      expect(call.data.isEnabled).toBe(false);
      expect(call.data.secretsCiphertext.length).toBe(ciphertext.length);
      expect(call.data.secretsCiphertext.every((b) => b === 0)).toBe(true);
    });
  });

  // ── dispatch ─────────────────────────────────────────────────────────────
  describe('dispatch', () => {
    const enabledInstall = {
      id: 'i1',
      orgId: 'o1',
      pluginId: 'echo',
      pluginVersion: '1.0.0',
      isEnabled: true,
      deletedAt: null,
      config: {},
    };

    it('happy path runs the handler with decrypted secrets', async () => {
      const { svc, prisma, secrets } = mkSvc();
      const { ciphertext, keyId } = secrets.encrypt({ apiToken: 'pk_x' });
      prisma.orgPluginInstall.findUnique.mockResolvedValue({ ...enabledInstall, secretsCiphertext: ciphertext, secretsKeyId: keyId });
      const result = await svc.dispatch('createIssue', 'i1', { title: 'hi' });
      expect(result).toEqual({ externalId: 'task-1' });
      const calls = dispatchHandler.mock.calls as unknown as Array<[{ secrets: { apiToken: string } }, unknown]>;
      expect(calls[0][0].secrets.apiToken).toBe('pk_x');
    });

    it('throws PluginNotEnabledError when install is missing', async () => {
      const { svc, prisma } = mkSvc();
      prisma.orgPluginInstall.findUnique.mockResolvedValue(null);
      await expect(svc.dispatch('createIssue', 'i1', {})).rejects.toBeInstanceOf(PluginNotEnabledError);
    });

    it('throws PluginNotEnabledError when install is disabled', async () => {
      const { svc, prisma, secrets } = mkSvc();
      const { ciphertext, keyId } = secrets.encrypt({ apiToken: 'x' });
      prisma.orgPluginInstall.findUnique.mockResolvedValue({ ...enabledInstall, isEnabled: false, secretsCiphertext: ciphertext, secretsKeyId: keyId });
      await expect(svc.dispatch('createIssue', 'i1', {})).rejects.toBeInstanceOf(PluginNotEnabledError);
    });

    it('throws PluginNotEnabledError when capability not in manifest', async () => {
      pluginRegistry._resetForTest();
      pluginRegistry.register(buildManifest({ capabilities: ['linkTicket'], handlers: { linkTicket: dispatchHandler } }));
      const { svc, prisma, secrets } = mkSvc();
      const { ciphertext, keyId } = secrets.encrypt({ apiToken: 'x' });
      prisma.orgPluginInstall.findUnique.mockResolvedValue({ ...enabledInstall, secretsCiphertext: ciphertext, secretsKeyId: keyId });
      await expect(svc.dispatch('createIssue', 'i1', {})).rejects.toBeInstanceOf(PluginNotEnabledError);
    });

    it('flips lastHealthOk to false on PluginAuthError + re-throws', async () => {
      pluginRegistry._resetForTest();
      pluginRegistry.register(
        buildManifest({
          handlers: {
            createIssue: jest.fn().mockRejectedValue(new PluginAuthError('401', 'echo')),
          },
        }),
      );
      const { svc, prisma, secrets } = mkSvc();
      const { ciphertext, keyId } = secrets.encrypt({ apiToken: 'x' });
      prisma.orgPluginInstall.findUnique.mockResolvedValue({ ...enabledInstall, secretsCiphertext: ciphertext, secretsKeyId: keyId });
      prisma.orgPluginInstall.update.mockResolvedValue({});

      await expect(svc.dispatch('createIssue', 'i1', {})).rejects.toBeInstanceOf(PluginAuthError);
      const updateCall = prisma.orgPluginInstall.update.mock.calls[0][0] as { data: { lastHealthOk: boolean; lastHealthError: string } };
      expect(updateCall.data.lastHealthOk).toBe(false);
      expect(updateCall.data.lastHealthError).toContain('401');
    });

    it('does not flip health on PluginPermanentError (caller mistake, creds still ok)', async () => {
      pluginRegistry._resetForTest();
      pluginRegistry.register(
        buildManifest({
          handlers: {
            createIssue: jest.fn().mockRejectedValue(new PluginPermanentError('400', 'echo')),
          },
        }),
      );
      const { svc, prisma, secrets } = mkSvc();
      const { ciphertext, keyId } = secrets.encrypt({ apiToken: 'x' });
      prisma.orgPluginInstall.findUnique.mockResolvedValue({ ...enabledInstall, secretsCiphertext: ciphertext, secretsKeyId: keyId });

      await expect(svc.dispatch('createIssue', 'i1', {})).rejects.toBeInstanceOf(PluginPermanentError);
      expect(prisma.orgPluginInstall.update).not.toHaveBeenCalled();
    });
  });

  // ── healthCheck ──────────────────────────────────────────────────────────
  describe('healthCheck', () => {
    it('persists ok=true + connectedAs and logs flip when previously failing', async () => {
      const { svc, prisma, secrets } = mkSvc();
      const { ciphertext, keyId } = secrets.encrypt({ apiToken: 'x' });
      prisma.orgPluginInstall.findUnique.mockResolvedValue({
        id: 'i1', orgId: 'o', pluginId: 'echo', pluginVersion: '1.0.0', config: {},
        secretsCiphertext: ciphertext, secretsKeyId: keyId, deletedAt: null, lastHealthOk: false,
      });
      prisma.orgPluginInstall.update.mockResolvedValue({});

      const r = await svc.healthCheck('i1');
      expect(r.ok).toBe(true);
      const updateCall = prisma.orgPluginInstall.update.mock.calls[0][0] as { data: { lastHealthOk: boolean; lastHealthError: null } };
      expect(updateCall.data.lastHealthOk).toBe(true);
      expect(updateCall.data.lastHealthError).toBeNull();
    });

    it('records ok=false + error when manifest healthCheck throws', async () => {
      pluginRegistry._resetForTest();
      pluginRegistry.register(buildManifest({ healthCheck: async () => { throw new Error('boom'); } }));
      const { svc, prisma, secrets } = mkSvc();
      const { ciphertext, keyId } = secrets.encrypt({ apiToken: 'x' });
      prisma.orgPluginInstall.findUnique.mockResolvedValue({
        id: 'i1', orgId: 'o', pluginId: 'echo', pluginVersion: '1.0.0', config: {},
        secretsCiphertext: ciphertext, secretsKeyId: keyId, deletedAt: null, lastHealthOk: true,
      });
      prisma.orgPluginInstall.update.mockResolvedValue({});

      const r = await svc.healthCheck('i1');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('boom');
    });
  });
});
