import { EnablementService } from './enablement.service';
import { PluginNotEnabledError } from './plugin.errors';
import { pluginRegistry } from './registry';
import type { PluginManifest } from './types';
import { z } from 'zod';

/**
 * 4-level enablement gate truth table.
 *
 * The gate fails CLOSED at every level. We exercise each independently by
 * stubbing the underlying findMany — the service should never call the gate
 * past the first failure.
 */

const stubManifest = (id: string, capabilities: PluginManifest['capabilities']): PluginManifest => ({
  id,
  name: id,
  description: '',
  version: '0.0.1',
  capabilities,
  configSchema: z.any(),
  secretsSchema: z.any() as never,
  healthCheck: async () => ({ ok: true }),
  handlers: Object.fromEntries(capabilities.filter((c) => c !== 'webhookListener').map((c) => [c, async () => ({})])),
});

const baseBinding = {
  id: 'b1',
  install: {
    id: 'i1',
    pluginId: 'echo',
    pluginVersion: '0.0.1',
    isEnabled: true,
    lastHealthOk: true,
    deletedAt: null,
    displayLabel: null,
  },
};

function buildSvc(rows: unknown[]) {
  const prisma = {
    projectPluginBinding: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  } as unknown as ConstructorParameters<typeof EnablementService>[0];
  return new EnablementService(prisma);
}

describe('EnablementService', () => {
  beforeAll(() => {
    pluginRegistry._resetForTest();
    pluginRegistry.register(stubManifest('echo', ['createIssue', 'sendNotification']));
  });

  afterAll(() => pluginRegistry._resetForTest());

  it('returns the install when every level says yes', async () => {
    const svc = buildSvc([baseBinding]);
    const installs = await svc.getEnabledInstalls('p1', 'createIssue');
    expect(installs).toHaveLength(1);
    expect(installs[0].pluginId).toBe('echo');
  });

  it('isEnabled mirrors getEnabledInstalls non-empty', async () => {
    expect(await buildSvc([baseBinding]).isEnabled('p1', 'createIssue')).toBe(true);
    expect(await buildSvc([]).isEnabled('p1', 'createIssue')).toBe(false);
  });

  it('requireEnabled throws when the binding query is empty (lvl 1+2 fail)', async () => {
    await expect(buildSvc([]).requireEnabled('p1', 'createIssue')).rejects.toBeInstanceOf(
      PluginNotEnabledError,
    );
  });

  it('drops bindings whose plugin is not in the in-memory registry', async () => {
    const orphan = {
      ...baseBinding,
      install: { ...baseBinding.install, pluginId: 'unknown-plugin' },
    };
    const svc = buildSvc([orphan]);
    expect(await svc.getEnabledInstalls('p1', 'createIssue')).toHaveLength(0);
  });

  it('drops bindings whose plugin no longer declares the capability', async () => {
    const stripped = {
      ...baseBinding,
      install: { ...baseBinding.install, pluginId: 'echo' },
    };
    // echo only declares createIssue + sendNotification — pullTicketStatus
    // should fall through.
    const svc = buildSvc([stripped]);
    expect(await svc.getEnabledInstalls('p1', 'pullTicketStatus')).toHaveLength(0);
  });

  it('requireEnabled with pluginId filter returns only that plugin', async () => {
    pluginRegistry.register(stubManifest('echo2', ['createIssue']));
    const svc = buildSvc([
      baseBinding,
      { ...baseBinding, install: { ...baseBinding.install, id: 'i2', pluginId: 'echo2' } },
    ]);
    const onlyEcho2 = await svc.requireEnabled('p1', 'createIssue', 'echo2');
    expect(onlyEcho2.map((i) => i.pluginId)).toEqual(['echo2']);
  });
});
