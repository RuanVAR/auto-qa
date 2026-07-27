import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  buildMcpServer,
  type McpDeps,
} from './mcp.server';

describe('codebase MCP tools', () => {
  const envAccess = {
    assertProjectAccess: jest.fn(),
    assertElevatedProjectAccess: jest.fn(),
    assertEnvAccess: jest.fn(),
  };
  const audit = { log: jest.fn() };
  const retrieval = { retrieveChunks: jest.fn() };
  const repos = {
    indexSummary: jest.fn(),
    readRepoFile: jest.fn(),
  };
  const deps = {
    prisma: {},
    envAccess,
    audit,
    context: {},
    services: {
      tests: {},
      features: {},
      modules: {},
      projects: {},
      environments: {},
    },
    runs: {},
    pipelines: {},
    issues: {},
    ticketLinks: {},
    codebase: { retrieval, repos },
  } as unknown as McpDeps;

  let server: McpServer;
  let client: Client;

  beforeEach(async () => {
    jest.clearAllMocks();
    envAccess.assertProjectAccess.mockResolvedValue(undefined);
    envAccess.assertElevatedProjectAccess.mockResolvedValue(undefined);
    envAccess.assertEnvAccess.mockResolvedValue(undefined);
    audit.log.mockResolvedValue({});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = buildMcpServer(
      deps,
      {
        sub: 'user-1',
        activeOrgId: 'org-1',
        orgRole: 'ORG_MEMBER',
        platformRole: 'USER',
      },
      {
        apiTokenId: 'token-1',
        ip: '127.0.0.1',
        userAgent: 'mcp-test',
      },
    );
    client = new Client({ name: 'phase-5-test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('registers all three codebase tools', async () => {
    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'search_code',
      'list_indexed_repos',
      'read_repo_file',
    ]));
  });

  it('returns indexed selectors and routes and writes a successful audit record', async () => {
    retrieval.retrieveChunks.mockResolvedValue([{
      repo: { id: 'repo-1', owner: 'owner', name: 'app' },
      branch: 'release',
      commitSha: 'sha-1',
      filePath: 'src/login.ts',
      symbol: 'Login',
      content: 'export function Login() {}',
      selectors: ['data-testid=login'],
      routes: ['/login'],
      score: 0.99,
      stale: false,
      indexStatus: 'READY',
    }]);

    const response = await client.callTool({
      name: 'search_code',
      arguments: {
        projectId: 'project-1',
        query: 'login selector',
        environmentId: 'env-1',
        limit: 5,
      },
    });
    await flushPromises();

    expect(response.isError).not.toBe(true);
    expect(parseToolJson(response)).toEqual([
      expect.objectContaining({
        selectors: ['data-testid=login'],
        routes: ['/login'],
      }),
    ]);
    expect(retrieval.retrieveChunks).toHaveBeenCalledWith(
      'user-1',
      {
        projectId: 'project-1',
        query: 'login selector',
        environmentId: 'env-1',
        repoIds: undefined,
        filePathHint: undefined,
        limit: 5,
      },
      {
        jwtRoleHint: { orgRole: 'ORG_MEMBER', platformRole: 'USER' },
        orgId: 'org-1',
      },
    );
    expect(audit.log).toHaveBeenCalledWith(
      'user-1',
      'MCP_TOOL_CALL',
      'search_code',
      'project-1',
      expect.any(Object),
      { ok: true },
      expect.objectContaining({
        orgId: 'org-1',
        source: 'mcp',
        apiTokenId: 'token-1',
      }),
    );
  });

  it('denies a token that cannot access the requested project and audits the failure', async () => {
    envAccess.assertProjectAccess.mockRejectedValue(
      new ForbiddenException('Not a member of this project'),
    );

    const response = await client.callTool({
      name: 'search_code',
      arguments: {
        projectId: 'project-from-another-org',
        query: 'secret selector',
      },
    });
    await flushPromises();

    expect(response.isError).toBe(true);
    expect(toolText(response)).toContain('Not a member of this project');
    expect(retrieval.retrieveChunks).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      'user-1',
      'MCP_TOOL_CALL',
      'search_code',
      'search_code',
      expect.any(Object),
      {
        ok: false,
        error: 'Not a member of this project',
      },
      expect.objectContaining({ source: 'mcp' }),
    );
  });

  it('lists only the indexed repository summary returned by the scoped service', async () => {
    repos.indexSummary.mockResolvedValue({
      repositories: [{ id: 'repo-1', branchIndexes: [] }],
      totals: { repositories: 1, indexes: 0 },
    });

    const response = await client.callTool({
      name: 'list_indexed_repos',
      arguments: { projectId: 'project-1' },
    });

    expect(response.isError).not.toBe(true);
    expect(parseToolJson(response)).toEqual(expect.objectContaining({
      totals: expect.objectContaining({ repositories: 1 }),
    }));
    expect(repos.indexSummary).toHaveBeenCalledWith('project-1');
  });

  it('returns an MCP error when the repository path policy blocks a file', async () => {
    repos.readRepoFile.mockRejectedValue(
      new BadRequestException(
        'Repository file path is blocked by the secret-file policy',
      ),
    );

    const response = await client.callTool({
      name: 'read_repo_file',
      arguments: {
        projectId: 'project-1',
        repoId: 'repo-1',
        path: '.env.production',
      },
    });
    await flushPromises();

    expect(response.isError).toBe(true);
    expect(toolText(response)).toContain('blocked by the secret-file policy');
    expect(repos.readRepoFile)
      .toHaveBeenCalledWith('project-1', 'repo-1', '.env.production', undefined);
    expect(audit.log).toHaveBeenCalledWith(
      'user-1',
      'MCP_TOOL_CALL',
      'read_repo_file',
      'read_repo_file',
      expect.any(Object),
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ source: 'mcp' }),
    );
  });
});

type ToolResponse = Awaited<ReturnType<Client['callTool']>>;

function toolText(response: ToolResponse): string {
  if (!Array.isArray(response.content)) {
    throw new Error('MCP tool response omitted content');
  }
  const text = response.content.find(
    (item: unknown): item is { type: 'text'; text: string } =>
      !!item
      && typeof item === 'object'
      && (item as { type?: unknown }).type === 'text'
      && typeof (item as { text?: unknown }).text === 'string',
  );
  if (!text) throw new Error('MCP tool response omitted text');
  return text.text;
}

function parseToolJson(response: ToolResponse): unknown {
  return JSON.parse(toolText(response));
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
