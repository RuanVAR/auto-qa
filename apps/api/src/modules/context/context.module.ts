import { Module } from '@nestjs/common';
import { ContextService } from './context.service';
import { ContextController } from './context.controller';

/**
 * Read-only test/feature context assembly (scope + ACs + docs), RBAC-checked.
 * EnvAccessService comes from the @Global AccessModule. Exported so the MCP
 * module can call it in-process.
 */
@Module({
  controllers: [ContextController],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
