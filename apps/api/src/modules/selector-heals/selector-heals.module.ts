import { forwardRef, Module } from '@nestjs/common';
import { SelectorHealsController } from './selector-heals.controller';
import { SelectorHealsService } from './selector-heals.service';
import { TestsModule } from '../tests/tests.module';

@Module({
  // Tests -> WorkSessions -> FeatureRuns -> Websocket closes the dependency
  // loop back to this module through terminal-run heal evaluation.
  imports: [forwardRef(() => TestsModule)],
  controllers: [SelectorHealsController],
  providers: [SelectorHealsService],
  exports: [SelectorHealsService],
})
export class SelectorHealsModule {}
