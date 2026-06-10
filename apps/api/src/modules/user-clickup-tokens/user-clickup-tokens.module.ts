import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { ClickUpLinksModule } from '../clickup-links/clickup-links.module';
import { UserClickUpTokenService } from './user-clickup-tokens.service';
import { UserClickUpTokenController } from './user-clickup-tokens.controller';

/**
 * Per-user ClickUp personal tokens. Exports the service so PluginService can
 * resolve a user's token at dispatch time (attribute ClickUp writes to them).
 * SecretsService is @Global; ClickUpLinksModule is imported for the auto-link.
 */
@Module({
  imports: [PrismaModule, AuditModule, ClickUpLinksModule],
  providers: [UserClickUpTokenService],
  controllers: [UserClickUpTokenController],
  exports: [UserClickUpTokenService],
})
export class UserClickUpTokensModule {}
