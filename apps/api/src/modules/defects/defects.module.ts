import { Module } from '@nestjs/common';
import { PluginsModule } from '../../plugins/plugins.module';
import { DefectsController } from './defects.controller';
import { DefectsService } from './defects.service';

@Module({ imports: [PluginsModule], controllers: [DefectsController], providers: [DefectsService], exports: [DefectsService] })
export class DefectsModule {}
