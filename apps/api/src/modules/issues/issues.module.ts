import { Module, forwardRef } from '@nestjs/common';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { WorkSessionsModule } from '../work-sessions/work-sessions.module';
import { PluginsModule } from '../../plugins/plugins.module';

@Module({
  imports: [WorkSessionsModule, forwardRef(() => PluginsModule)],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
