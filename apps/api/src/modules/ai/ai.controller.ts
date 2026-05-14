import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { GenerateTestDto } from './dto/generate-test.dto';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly service: AiService) {}

  @Post('runs/:runId/explain')
  @ApiOperation({ summary: 'AI explains failure' })
  async explain(@Param('runId') id: string) {
    const { response } = await this.service.explainFailure(id);
    return { response };
  }

  @Post('runs/:runId/summarise')
  @ApiOperation({ summary: 'AI summarises run' })
  async summarise(@Param('runId') id: string) {
    const { response } = await this.service.summariseRun(id);
    return { response };
  }

  @Post('projects/:projectId/generate-test')
  @ApiOperation({ summary: 'AI generates test from prompt' })
  generateTest(@Param('projectId') projectId: string, @Body() dto: GenerateTestDto) {
    return this.service.generateTest(dto.prompt, projectId);
  }
}
