import { Module } from '@nestjs/common';
import { SelectorHealsController } from './selector-heals.controller';
import { SelectorHealsService } from './selector-heals.service';
import { TestsModule } from '../tests/tests.module';

@Module({
  imports: [TestsModule],
  controllers: [SelectorHealsController],
  providers: [SelectorHealsService],
  exports: [SelectorHealsService],
})
export class SelectorHealsModule {}
