import { Module } from '@nestjs/common';
import { ImportExportService } from './import-export.service';
import { ImportExportController } from './import-export.controller';
import { AIExportService } from './ai-export/ai-export.service';
import { AIExportController } from './ai-export/ai-export.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PluginsModule } from '../../plugins/plugins.module';

@Module({
  imports: [PrismaModule, PluginsModule],
  controllers: [ImportExportController, AIExportController],
  providers: [ImportExportService, AIExportService],
  exports: [ImportExportService, AIExportService],
})
export class ImportExportModule {}
