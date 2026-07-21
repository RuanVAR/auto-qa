import { Module } from '@nestjs/common';
import { DefectsController } from './defects.controller';
import { DefectsService } from './defects.service';

@Module({ controllers: [DefectsController], providers: [DefectsService], exports: [DefectsService] })
export class DefectsModule {}
