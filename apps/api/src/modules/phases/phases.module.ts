import { Module } from '@nestjs/common';
import { PhasesController } from './phases.controller';
import { PhasesService } from './phases.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PluginsModule } from '../../plugins/plugins.module';

@Module({
  imports: [NotificationsModule, PluginsModule],
  controllers: [PhasesController],
  providers: [PhasesService],
  exports: [PhasesService],
})
export class PhasesModule {}
