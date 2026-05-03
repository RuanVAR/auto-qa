import { Module } from '@nestjs/common';
import { ModulesController } from './modules.controller';
import { ModulesService } from './modules.service';
import { StatsModule } from '../stats/stats.module';
import { ImportExportModule } from '../import-export/import-export.module';

@Module({
  imports: [StatsModule, ImportExportModule],
  controllers: [ModulesController],
  providers: [ModulesService],
  exports: [ModulesService],
})
export class ModulesModule {}
