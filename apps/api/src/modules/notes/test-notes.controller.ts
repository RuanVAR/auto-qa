import { Controller, Get, Put, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { NotesService } from './notes.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

class UpsertTestNoteDto {
  @IsString()
  content: string;
}

/**
 * Shared per-test note ("Test notes" tab) — one markdown blob per test, readable
 * + editable by anyone with access to the test's project. Personal notes reuse
 * the per-project endpoints in NotesController.
 */
@ApiTags('notes') @ApiBearerAuth()
@Controller()
export class TestNotesController {
  constructor(private readonly service: NotesService) {}

  @Get('tests/:testId/notes')
  @ApiOperation({ summary: 'Get the shared note for a test' })
  getTestNote(@Param('testId') testId: string, @CurrentUser() user: JwtPayload) {
    return this.service.getTestNote(user, testId);
  }

  @Put('tests/:testId/notes')
  @ApiOperation({ summary: 'Save the shared note for a test' })
  upsertTestNote(@Param('testId') testId: string, @CurrentUser() user: JwtPayload, @Body() dto: UpsertTestNoteDto) {
    return this.service.upsertTestNote(user, testId, dto.content);
  }

  @Get('features/:featureId/test-notes-presence')
  @ApiOperation({ summary: 'Test ids in a feature that have a non-empty shared note' })
  presence(@Param('featureId') featureId: string, @CurrentUser() user: JwtPayload) {
    return this.service.testNotePresence(user, featureId);
  }
}
