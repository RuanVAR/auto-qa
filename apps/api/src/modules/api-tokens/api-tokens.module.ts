import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ApiTokensService } from './api-tokens.service';
import { ApiTokensController } from './api-tokens.controller';

/**
 * Personal access tokens (PATs) — the credential the MCP server and direct API
 * access authenticate with. Exports ApiTokensService so the global
 * JwtOrApiTokenGuard can resolve PATs to a user context.
 */
@Module({
  imports: [AuditModule],
  controllers: [ApiTokensController],
  providers: [ApiTokensService],
  exports: [ApiTokensService],
})
export class ApiTokensModule {}
