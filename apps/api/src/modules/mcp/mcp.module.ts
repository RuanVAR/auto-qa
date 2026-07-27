import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ContextModule } from '../context/context.module';
import { TestsModule } from '../tests/tests.module';
import { FeaturesModule } from '../features/features.module';
import { ModulesModule } from '../modules/modules.module';
import { ProjectsModule } from '../projects/projects.module';
import { FeatureRunsModule } from '../feature-runs/feature-runs.module';
import { EnvironmentsModule } from '../environments/environments.module';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { IssuesModule } from '../issues/issues.module';
import { PluginsModule } from '../../plugins/plugins.module';
import { McpService } from './mcp.service';
import { McpController } from './mcp.controller';
import { CodebaseIndexingModule } from '../codebase-indexing/codebase-indexing.module';
import { GithubIntegrationModule } from '../github-integration/github-integration.module';

/**
 * Embedded MCP server. Reuses Prisma + EnvAccessService (RBAC) + AuditService +
 * ContextService in-process; the global guard authenticates the PAT. Read tools
 * in v1; CRUD lands in M-5.
 */
@Module({
  // IssuesModule for bug CRUD tools; PluginsModule for TicketLinkingService
  // (create/link/unlink ClickUp tickets across feature/module/defect/bug scopes).
  imports: [
    AuditModule,
    ContextModule,
    TestsModule,
    FeaturesModule,
    ModulesModule,
    ProjectsModule,
    FeatureRunsModule,
    EnvironmentsModule,
    PipelinesModule,
    IssuesModule,
    PluginsModule,
    CodebaseIndexingModule,
    GithubIntegrationModule,
  ],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
