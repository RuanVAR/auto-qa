import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PluginsModule } from '../../plugins/plugins.module';
import { ClickUpLinksService } from './clickup-links.service';
import { ClickUpLinksController } from './clickup-links.controller';

@Module({
  imports: [PrismaModule, PluginsModule],
  providers: [ClickUpLinksService],
  controllers: [ClickUpLinksController],
  exports: [ClickUpLinksService],
})
export class ClickUpLinksModule {}
