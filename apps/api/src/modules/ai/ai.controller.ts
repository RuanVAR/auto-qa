import { Controller, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { GenerateTestDto } from './dto/generate-test.dto';

@ApiTags('ai') @ApiBearerAuth() @Controller('ai')
export class AiController {
  constructor(private readonly service: AiService) {}
  @Post('runs/:runId/explain') @ApiOperation({ summary: 'AI explains failure' }) explain(@Param('runId') id: string) { return this.service.explainFailure(id); }
  @Post('runs/:runId/summarise') @ApiOperation({ summary: 'AI summarises run' }) summarise(@Param('runId') id: string) { return this.service.summariseRun(id); }
  @Post('projects/:projectId/generate-test') @ApiOperation({ summary: 'AI generates test from prompt' })
  generateTest(@Param('projectId') projectId: string, @Body() dto: GenerateTestDto) { return this.service.generateTest(dto.prompt, projectId); }
}
