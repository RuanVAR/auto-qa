import { Module } from '@nestjs/common';
import { ProjectsController, ProjectMembersController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { AuditModule } from '../audit/audit.module';
import { StatsModule } from '../stats/stats.module';

@Module({
  imports: [AuditModule, StatsModule],
  controllers: [ProjectsController, ProjectMembersController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
