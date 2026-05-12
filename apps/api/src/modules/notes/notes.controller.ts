import { Controller, Get, Put, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { NotesService } from './notes.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

class UpsertNoteDto {
  @IsString()
  content: string;
}

@ApiTags('notes') @ApiBearerAuth()
@Controller('projects/:projectId/notes/me')
export class NotesController {
  constructor(private readonly service: NotesService) {}

  @Get() @ApiOperation({ summary: 'Get current user note for a project' })
  getNote(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.getNote(user.sub, projectId);
  }

  @Put() @ApiOperation({ summary: 'Save current user note for a project' })
  upsertNote(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertNoteDto,
  ) {
    return this.service.upsertNote(user.sub, projectId, dto.content);
  }
}
