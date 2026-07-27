import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AccessModule } from '../../common/access/access.module';
import { SharedStepsController } from './shared-steps.controller';
import { SharedStepsService } from './shared-steps.service';
import { SharedStepReferenceIndexService } from './shared-step-reference-index.service';
import { SharedStepResolverService } from './shared-step-resolver.service';
import { RunSpecService } from './run-spec.service';

@Module({
  imports: [PrismaModule, AuditModule, AccessModule],
  controllers: [SharedStepsController],
  providers: [SharedStepsService, SharedStepReferenceIndexService, SharedStepResolverService, RunSpecService],
  exports: [SharedStepReferenceIndexService, RunSpecService],
})
export class SharedStepsModule {}
