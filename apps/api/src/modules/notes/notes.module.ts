import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller';
import { TestNotesController } from './test-notes.controller';
import { NotesService } from './notes.service';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [NotesController, TestNotesController],
  providers: [NotesService],
})
export class NotesModule {}
