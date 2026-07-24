import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditModule } from '../audit/audit.module';
import { OrganisationsModule } from '../organisations/organisations.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule for the platform-admin "send password reset" action, which
  // reuses AuthService.requestPasswordReset (global — no org scoping).
  imports: [AuditModule, OrganisationsModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
