import { Injectable, Logger } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvAccessService } from '../../common/access/env-access.service';
import { AuditService } from '../audit/audit.service';
import { ContextService } from '../context/context.service';
import { TestsService } from '../tests/tests.service';
import { FeaturesService } from '../features/features.service';
import { ModulesService } from '../modules/modules.service';
import { ProjectsService } from '../projects/projects.service';
import { FeatureRunsService } from '../feature-runs/feature-runs.service';
import { PipelinesService } from '../pipelines/pipelines.service';
import { EnvironmentsService } from '../environments/environments.service';
import { IssuesService } from '../issues/issues.service';
import { TicketLinkingService } from '../../plugins/ticket-linking.service';
import { CodebaseRetrievalService } from '../codebase-indexing/codebase-retrieval.service';
import { ProjectReposService } from '../github-integration/project-repos.service';
import { buildMcpServer, IssueServices, McpAuditCtx, McpUser, PipelineServices, RunServices, WriteServices } from './mcp.server';

/**
 * Drives MCP requests over Streamable HTTP. Stateful sessions: an `initialize`
 * POST mints a session bound to the authenticated user (its tools carry that
 * user's RBAC); subsequent requests carrying the Mcp-Session-Id reuse it. The
 * global guard re-validates the PAT on every request, so revocation takes
 * effect mid-session. In-memory session store (single API instance).
 */
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);
  private readonly sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();
  private static readonly MAX_SESSIONS = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly envAccess: EnvAccessService,
    private readonly audit: AuditService,
    private readonly context: ContextService,
    private readonly tests: TestsService,
    private readonly features: FeaturesService,
    private readonly modules: ModulesService,
    private readonly projects: ProjectsService,
    private readonly featureRuns: FeatureRunsService,
    private readonly pipelines: PipelinesService,
    private readonly environments: EnvironmentsService,
    private readonly issues: IssuesService,
    private readonly ticketLinks: TicketLinkingService,
    private readonly codebaseRetrieval: CodebaseRetrievalService,
    private readonly projectRepos: ProjectReposService,
  ) {}

  private writeServices(): WriteServices {
    return {
      tests: this.tests,
      features: this.features,
      modules: this.modules,
      projects: this.projects,
      environments: this.environments,
    } as unknown as WriteServices;
  }

  async handle(
    rawReq: IncomingMessage,
    rawRes: ServerResponse,
    body: unknown,
    user: McpUser,
    auditCtx: McpAuditCtx,
  ): Promise<void> {
    const sid = rawReq.headers['mcp-session-id'];
    const existing = typeof sid === 'string' ? this.sessions.get(sid) : undefined;
    if (existing) {
      await existing.transport.handleRequest(rawReq as never, rawRes as never, body);
      return;
    }

    // New session (an `initialize` POST). GET/DELETE without a known session
    // will be rejected by the transport with a 4xx.
    if (this.sessions.size >= McpService.MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (oldest) this.sessions.get(oldest)?.transport.close().catch(() => undefined);
    }

    const server = buildMcpServer(
      {
        prisma: this.prisma, envAccess: this.envAccess, audit: this.audit, context: this.context,
        services: this.writeServices(),
        runs: this.featureRuns as unknown as RunServices,
        pipelines: this.pipelines as unknown as PipelineServices,
        issues: this.issues as unknown as IssueServices,
        ticketLinks: this.ticketLinks,
        codebase: {
          retrieval: this.codebaseRetrieval,
          repos: this.projectRepos,
        },
      },
      user,
      auditCtx,
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (newId: string) => {
        this.sessions.set(newId, { transport, server });
        this.logger.debug(`MCP session ${newId} opened for user ${user.sub}`);
      },
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) this.sessions.delete(id);
      void server.close();
    };

    await server.connect(transport);
    await transport.handleRequest(rawReq as never, rawRes as never, body);
  }
}
