import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { QuarantineService } from './quarantine.service';

@Module({ imports: [NotificationsModule], providers: [QuarantineService], exports: [QuarantineService] })
export class QuarantineModule {}
