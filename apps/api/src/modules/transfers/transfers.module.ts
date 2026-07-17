import { Module } from '@nestjs/common';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { TransferPlanService } from './transfer-plan.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { EmailModule } from '../../email/email.module';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [TransfersController],
  providers: [TransfersService, TransferPlanService],
  exports: [TransfersService],
})
export class TransfersModule {}
