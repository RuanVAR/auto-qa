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
import { McpService } from './mcp.service';
import { McpController } from './mcp.controller';

/**
 * Embedded MCP server. Reuses Prisma + EnvAccessService (RBAC) + AuditService +
 * ContextService in-process; the global guard authenticates the PAT. Read tools
 * in v1; CRUD lands in M-5.
 */
@Module({
  imports: [AuditModule, ContextModule, TestsModule, FeaturesModule, ModulesModule, ProjectsModule, FeatureRunsModule, EnvironmentsModule, PipelinesModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
