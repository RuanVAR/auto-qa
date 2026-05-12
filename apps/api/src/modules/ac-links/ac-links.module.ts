import { Module } from '@nestjs/common';
import { AcLinksController } from './ac-links.controller';
import { AcLinksService } from './ac-links.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PluginsModule } from '../../plugins/plugins.module';

@Module({
  imports: [PrismaModule, PluginsModule],
  controllers: [AcLinksController],
  providers: [AcLinksService],
})
export class AcLinksModule {}
