import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiCredentialController } from './ai-credential.controller';
import { AiCredentialService } from './ai-credential.service';
import { AiCredentialResolver } from './credential-resolver.service';
import { AiCostCalculator } from './cost-calculator.service';
import { AiQuotaGuard } from './guards/ai-quota.guard';

/**
 * AI module wires three flavours of consumers:
 *
 *   • AiService            — legacy run-summary / failure-explain / generate-test
 *                            entry points, now routed through AiCredentialResolver
 *                            so they pick up the per-org BYOK setting.
 *   • AiCredentialService  — settings page CRUD + monthly spend rollup.
 *   • AiQuotaGuard         — quota + rate-limit + concurrency guard
 *                            (invoked by the generation orchestrator in Phase 1+).
 *
 * SecretsModule is @Global so we don't need to import it here.
 */
@Module({
  controllers: [AiController, AiCredentialController],
  providers: [
    AiService,
    AiCredentialService,
    AiCredentialResolver,
    AiCostCalculator,
    AiQuotaGuard,
  ],
  exports: [AiService, AiCredentialService, AiCredentialResolver, AiCostCalculator, AiQuotaGuard],
})
export class AiModule {}
