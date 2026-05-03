import { Module } from '@nestjs/common';
import { ImportExportService } from './import-export.service';
import { ImportExportController } from './import-export.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ImportExportController],
  providers: [ImportExportService],
  exports: [ImportExportService],
})
export class ImportExportModule {}
