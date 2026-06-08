import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ContextModule } from '../context/context.module';
import { McpService } from './mcp.service';
import { McpController } from './mcp.controller';

/**
 * Embedded MCP server. Reuses Prisma + EnvAccessService (RBAC) + AuditService +
 * ContextService in-process; the global guard authenticates the PAT. Read tools
 * in v1; CRUD lands in M-5.
 */
@Module({
  imports: [AuditModule, ContextModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
