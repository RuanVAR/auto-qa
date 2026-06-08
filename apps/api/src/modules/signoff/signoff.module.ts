import { Module } from '@nestjs/common';
import { SignoffController } from './signoff.controller';
import { SignoffService } from './signoff.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../../email/email.module';
import { StatsModule } from '../stats/stats.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [NotificationsModule, EmailModule, StatsModule, QueueModule],
  controllers: [SignoffController],
  providers: [SignoffService],
  exports: [SignoffService],
})
export class SignoffModule {}
