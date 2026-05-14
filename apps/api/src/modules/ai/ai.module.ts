import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiCredentialController } from './ai-credential.controller';
import { AiCredentialService } from './ai-credential.service';
import { AiCredentialResolver } from './credential-resolver.service';
import { AiCostCalculator } from './cost-calculator.service';
import { AiQuotaGuard } from './guards/ai-quota.guard';
import { AiGenerationController } from './ai-generation.controller';
import { AiGenerationService } from './generation.service';

/**
 * AI module wires four flavours of consumers:
 *
 *   • AiService            — legacy run-summary / failure-explain / generate-test
 *                            entry points, now routed through AiCredentialResolver
 *                            so they pick up the per-org BYOK setting.
 *   • AiCredentialService  — settings page CRUD + monthly spend rollup.
 *   • AiGenerationService  — Phase 1+ generation surfaces (G3 ships first).
 *                            Streams phase events; persists AISummary with
 *                            cost + prompt version for audit.
 *   • AiQuotaGuard         — quota + rate-limit + concurrency guard
 *                            invoked by the generation orchestrator.
 *
 * SecretsModule is @Global so we don't need to import it here.
 */
@Module({
  controllers: [AiController, AiCredentialController, AiGenerationController],
  providers: [
    AiService,
    AiCredentialService,
    AiCredentialResolver,
    AiCostCalculator,
    AiQuotaGuard,
    AiGenerationService,
  ],
  exports: [
    AiService,
    AiCredentialService,
    AiCredentialResolver,
    AiCostCalculator,
    AiQuotaGuard,
    AiGenerationService,
  ],
})
export class AiModule {}
