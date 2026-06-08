import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
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
export interface McpDeps {
  prisma: PrismaService;
  envAccess: EnvAccessService;
  audit: AuditService;
  context: ContextService;
}

const SERVER_NAME = 'qa-platform';
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

  return server;
}
