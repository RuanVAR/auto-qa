import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { appName } from '../../common/config/app';
import { EnvAccessService } from '../../common/access/env-access.service';
import { AuditService } from '../audit/audit.service';
import { ContextService, AccessCtx } from '../context/context.service';

export interface McpUser {
  sub: string;
  orgRole?: string | null;
  platformRole?: string | null;
  activeOrgId?: string | null;
}
export interface McpAuditCtx {
  ip?: string | null;
  userAgent?: string | null;
  apiTokenId?: string | null;
}
/**
 * Loose method shapes for the domain services the write tools wrap. Method
 * syntax = bivariant params, so the real (strongly-typed) services are
 * assignable. We reuse the services so DTO handling + their own entity audit
 * (CREATE/UPDATE rows) fire exactly as for the web app.
 */
export interface WriteServices {
  tests: {
    create(projectId: string, dto: Record<string, unknown>, userId?: string): Promise<{ id: string }>;
    update(id: string, dto: Record<string, unknown>, userId?: string): Promise<{ id: string }>;
  };
  features: {
    create(moduleId: string, dto: Record<string, unknown>): Promise<{ id: string }>;
    update(id: string, dto: Record<string, unknown>): Promise<{ id: string }>;
  };
  modules: {
    create(projectId: string, dto: Record<string, unknown>): Promise<{ id: string }>;
    update(id: string, dto: Record<string, unknown>): Promise<{ id: string }>;
  };
  projects: {
    create(dto: Record<string, unknown>, ownerId: string, orgId?: string | null): Promise<{ id: string }>;
    update(id: string, dto: Record<string, unknown>, userId?: string): Promise<{ id: string }>;
  };
}

export interface RunServices {
  start(featureId: string, dto: Record<string, unknown>, userId?: string): Promise<{ id: string; status: string }>;
  findOne(id: string): Promise<unknown>;
}

export interface McpDeps {
  prisma: PrismaService;
  envAccess: EnvAccessService;
  audit: AuditService;
  context: ContextService;
  services: WriteServices;
  runs: RunServices;
}

/** A test "runs code" (SHELL / raw-JS step) — needs elevated authoring rights. */
function hasCodeExecContent(type: string | undefined, steps: unknown): boolean {
  if (type === 'SHELL') return true;
  if (Array.isArray(steps)) {
    for (const s of steps) {
      const st = s as { type?: string; input?: { from?: string } } | null;
      if (st?.type === 'EXECUTE_SCRIPT') return true;
      if (st?.type === 'STORE' && st?.input?.from === 'expression') return true;
    }
  }
  return false;
}

const SERVER_NAME = appName();
const SERVER_VERSION = '0.1.0';

/**
 * Build a fresh MCP server for one request, bound to the authenticated user.
 * Every tool runs with that user's RBAC (assertProjectAccess) and writes an
 * MCP_TOOL_CALL audit row. Read-only tools for v1 (CRUD lands in M-5).
 */
export function buildMcpServer(deps: McpDeps, user: McpUser, auditCtx: McpAuditCtx): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const access: AccessCtx = {
    userId: user.sub,
    jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
    orgId: user.activeOrgId ?? null,
  };
  const assertProject = (projectId: string) =>
    deps.envAccess.assertProjectAccess(user.sub, projectId, { jwtRoleHint: access.jwtRoleHint, orgId: access.orgId });
  const assertElevated = (projectId: string) =>
    deps.envAccess.assertElevatedProjectAccess(user.sub, projectId, { jwtRoleHint: access.jwtRoleHint, orgId: access.orgId });
  const projectIdOfModule = async (moduleId: string): Promise<string> => {
    const m = await deps.prisma.module.findFirst({ where: { id: moduleId, deletedAt: null }, select: { projectId: true } });
    if (!m) throw new Error('Module not found');
    return m.projectId;
  };
  const projectIdOfFeature = async (featureId: string): Promise<string> => {
    const f = await deps.prisma.feature.findFirst({ where: { id: featureId, deletedAt: null }, select: { module: { select: { projectId: true } } } });
    if (!f) throw new Error('Feature not found');
    return f.module.projectId;
  };
  const projectIdOfTest = async (testId: string): Promise<string> => {
    const t = await deps.prisma.testDefinition.findFirst({ where: { id: testId, deletedAt: null }, select: { projectId: true } });
    if (!t) throw new Error('Test not found');
    return t.projectId;
  };

  // Wrap a tool handler with audit + uniform JSON text output. Kept
  // non-generic (args: any) on purpose — the SDK's registerTool + zod inference
  // otherwise blows the TS instantiation depth (TS2589).
  const tool = (
    name: string,
    description: string,
    inputSchema: z.ZodRawShape,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (args: any) => Promise<{ result: unknown; affectedId?: string }>,
  ) => {
    const handler = async (args: Record<string, unknown>) => {
      try {
        const { result, affectedId } = await run(args);
        void deps.audit.log(user.sub, 'MCP_TOOL_CALL', name, affectedId ?? name, { args }, { ok: true }, {
          orgId: access.orgId, ip: auditCtx.ip, userAgent: auditCtx.userAgent, source: 'mcp', apiTokenId: auditCtx.apiTokenId,
        }).catch(() => undefined);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'tool failed';
        void deps.audit.log(user.sub, 'MCP_TOOL_CALL', name, name, { args }, { ok: false, error: message }, {
          orgId: access.orgId, ip: auditCtx.ip, userAgent: auditCtx.userAgent, source: 'mcp', apiTokenId: auditCtx.apiTokenId,
        }).catch(() => undefined);
        return { isError: true, content: [{ type: 'text' as const, text: message }] };
      }
    };
    // Cast to a concrete signature: registerTool's generics infer the whole
    // zod shape and overflow TS's instantiation depth (TS2589) otherwise.
    (server.registerTool as unknown as (
      n: string,
      c: { description: string; inputSchema: z.ZodRawShape },
      cb: (args: Record<string, unknown>) => Promise<unknown>,
    ) => void)(name, { description, inputSchema }, handler);
  };

  // ── Read tools ────────────────────────────────────────────────────────────

  tool('list_projects', 'List the projects you can access.', {}, async () => {
    const isPlatformAdmin = user.platformRole === 'PLATFORM_ADMIN';
    const orgAdminOf = user.orgRole === 'ORG_ADMIN' && user.activeOrgId ? user.activeOrgId : null;
    const where = isPlatformAdmin
      ? { deletedAt: null, isActive: true }
      : {
          deletedAt: null,
          isActive: true,
          OR: [
            { members: { some: { userId: user.sub } } },
            ...(orgAdminOf ? [{ orgId: orgAdminOf }] : []),
          ],
        };
    const rows = await deps.prisma.project.findMany({
      where, select: { id: true, name: true, description: true, orgId: true }, orderBy: { name: 'asc' }, take: 200,
    });
    return { result: rows };
  });

  tool('list_modules', 'List modules in a project.', { projectId: z.string() }, async ({ projectId }) => {
    await assertProject(projectId);
    const rows = await deps.prisma.module.findMany({
      where: { projectId, deletedAt: null }, select: { id: true, name: true, description: true, tags: true }, orderBy: { order: 'asc' },
    });
    return { result: rows };
  });

  tool('list_features', 'List features in a module.', { moduleId: z.string() }, async ({ moduleId }) => {
    const mod = await deps.prisma.module.findFirst({ where: { id: moduleId, deletedAt: null }, select: { projectId: true } });
    if (!mod) throw new Error('Module not found');
    await assertProject(mod.projectId);
    const rows = await deps.prisma.feature.findMany({
      where: { moduleId, deletedAt: null }, select: { id: true, name: true, description: true, tags: true }, orderBy: { order: 'asc' },
    });
    return { result: rows };
  });

  tool('search_tests', 'Search test definitions in a project (optionally by feature, free-text, or tags).',
    { projectId: z.string(), query: z.string().optional(), featureId: z.string().optional(), tags: z.array(z.string()).optional() },
    async ({ projectId, query, featureId, tags }) => {
      await assertProject(projectId);
      const rows = await deps.prisma.testDefinition.findMany({
        where: {
          projectId, deletedAt: null,
          ...(featureId ? { featureId } : {}),
          ...(query ? { OR: [{ name: { contains: query, mode: 'insensitive' } }, { description: { contains: query, mode: 'insensitive' } }] } : {}),
          ...(tags && tags.length ? { tags: { hasSome: tags } } : {}),
        },
        select: { id: true, name: true, type: true, featureId: true, tags: true }, orderBy: { updatedAt: 'desc' }, take: 100,
      });
      return { result: rows };
    });

  tool('get_test', 'Get one test definition with its steps.', { testId: z.string() }, async ({ testId }) => {
    const t = await deps.prisma.testDefinition.findFirst({
      where: { id: testId, deletedAt: null },
      select: { id: true, name: true, description: true, type: true, tags: true, steps: true, featureId: true, projectId: true },
    });
    if (!t) throw new Error('Test not found');
    await assertProject(t.projectId);
    return { result: t };
  });

  tool('get_test_context', 'Get a test plus its scope, acceptance criteria and linked docs.', { testId: z.string() },
    async ({ testId }) => ({ result: await deps.context.forTest(testId, access) }));

  tool('get_feature_context', 'Get a feature plus its scope, acceptance criteria, docs and tests.', { featureId: z.string() },
    async ({ featureId }) => ({ result: await deps.context.forFeature(featureId, access) }));

  tool('get_docs', 'Get the docs linked to a feature (internal + cached external).', { featureId: z.string() },
    async ({ featureId }) => {
      const ctx = await deps.context.forFeature(featureId, access);
      return { result: ctx.docs };
    });

  // ── Write tools (CRUD) ──────────────────────────────────────────────────────
  // Each asserts project membership; test writes that introduce code-exec
  // content additionally require elevated role.

  const stepSchema = z.array(z.record(z.string(), z.unknown()));

  tool('create_test', 'Create a test definition under a project (optionally a feature).',
    { projectId: z.string(), name: z.string(), featureId: z.string().optional(), type: z.string().optional(),
      description: z.string().optional(), tags: z.array(z.string()).optional(), steps: stepSchema.optional() },
    async ({ projectId, name, featureId, type, description, tags, steps }) => {
      await assertProject(projectId);
      if (hasCodeExecContent(type, steps)) await assertElevated(projectId);
      const created = await deps.services.tests.create(projectId,
        { name, featureId, type: type ?? 'UI', description, tags: tags ?? [], steps: steps ?? [] }, user.sub);
      return { result: created, affectedId: created.id };
    });

  tool('update_test', 'Update a test definition.',
    { testId: z.string(), name: z.string().optional(), description: z.string().optional(),
      type: z.string().optional(), tags: z.array(z.string()).optional(), steps: stepSchema.optional() },
    async ({ testId, ...patch }) => {
      const projectId = await projectIdOfTest(testId);
      await assertProject(projectId);
      if (hasCodeExecContent(patch.type, patch.steps)) await assertElevated(projectId);
      const updated = await deps.services.tests.update(testId, dropUndefined(patch), user.sub);
      return { result: updated, affectedId: updated.id };
    });

  tool('create_feature', 'Create a feature under a module.',
    { moduleId: z.string(), name: z.string(), description: z.string().optional(), tags: z.array(z.string()).optional() },
    async ({ moduleId, name, description, tags }) => {
      await assertProject(await projectIdOfModule(moduleId));
      const created = await deps.services.features.create(moduleId, { name, description, tags: tags ?? [] });
      return { result: created, affectedId: created.id };
    });

  tool('update_feature', 'Update a feature.',
    { featureId: z.string(), name: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional() },
    async ({ featureId, ...patch }) => {
      await assertProject(await projectIdOfFeature(featureId));
      const updated = await deps.services.features.update(featureId, dropUndefined(patch));
      return { result: updated, affectedId: updated.id };
    });

  tool('create_module', 'Create a module under a project.',
    { projectId: z.string(), name: z.string(), description: z.string().optional(), tags: z.array(z.string()).optional() },
    async ({ projectId, name, description, tags }) => {
      await assertProject(projectId);
      const created = await deps.services.modules.create(projectId, { name, description, tags: tags ?? [] });
      return { result: created, affectedId: created.id };
    });

  tool('update_module', 'Update a module.',
    { moduleId: z.string(), name: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional() },
    async ({ moduleId, ...patch }) => {
      await assertProject(await projectIdOfModule(moduleId));
      const updated = await deps.services.modules.update(moduleId, dropUndefined(patch));
      return { result: updated, affectedId: updated.id };
    });

  tool('create_project', 'Create a project in your active organisation.',
    { name: z.string(), description: z.string().optional() },
    async ({ name, description }) => {
      if (!user.activeOrgId) throw new Error('No active organisation to create the project in');
      // The project model requires a unique slug; the UI supplies one, so the
      // MCP tool derives it from the name (with a short suffix if taken).
      const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
      const taken = await deps.prisma.project.findFirst({ where: { slug: base }, select: { id: true } });
      const slug = taken ? `${base}-${Date.now().toString(36).slice(-4)}` : base;
      const created = await deps.services.projects.create({ name, slug, description }, user.sub, user.activeOrgId);
      return { result: created, affectedId: created.id };
    });

  // ── Run tools ───────────────────────────────────────────────────────────────

  tool('trigger_feature_run', 'Start an AUTOMATED run of a feature in an environment.',
    { featureId: z.string(), environmentId: z.string() },
    async ({ featureId, environmentId }) => {
      const projectId = await projectIdOfFeature(featureId);
      await deps.envAccess.assertEnvAccess(user.sub, projectId, environmentId, { jwtRoleHint: access.jwtRoleHint, orgId: access.orgId });
      const run = await deps.runs.start(featureId, { runMode: 'AUTOMATED', environmentId }, user.sub);
      return { result: { runId: run.id, status: run.status }, affectedId: run.id };
    });

  tool('get_feature_run', 'Get the status of a feature run (per-test results).', { runId: z.string() },
    async ({ runId }) => {
      const fr = await deps.prisma.featureRun.findUnique({
        where: { id: runId }, select: { feature: { select: { module: { select: { projectId: true } } } } },
      });
      if (!fr) throw new Error('Feature run not found');
      await assertProject(fr.feature.module.projectId);
      return { result: await deps.runs.findOne(runId) };
    });

  return server;
}

function dropUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}
