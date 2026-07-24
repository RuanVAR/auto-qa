import { Module } from '@nestjs/common';
import { OrganisationsService } from './organisations.service';
import { OrganisationsController } from './organisations.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule for the org-admin "send password reset" action, which reuses
  // AuthService.requestPasswordReset. No cycle — AuthModule doesn't depend on
  // OrganisationsModule.
  imports: [PrismaModule, AuditModule, AuthModule],
  controllers: [OrganisationsController],
  providers: [OrganisationsService],
  exports: [OrganisationsService],
})
export class OrganisationsModule {}
