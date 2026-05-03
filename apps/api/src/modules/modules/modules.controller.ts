import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ModulesService } from './modules.service';
import { StatsService } from '../stats/stats.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('modules') @ApiBearerAuth()
@Controller('projects/:projectId/modules')
export class ModulesController {
  constructor(
    private readonly service: ModulesService,
    private readonly statsService: StatsService,
  ) {}

  @Get() @ApiOperation({ summary: 'List modules for a project' })
  findAll(@Param('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Get('stats') @ApiOperation({ summary: 'Get stats for all modules in a project' })
  getStats(@Param('projectId') projectId: string) {
    return this.statsService.computeModuleStatsForProject(projectId);
  }

  @Get('tags') @ApiOperation({ summary: 'Get distinct tags across all modules in a project' })
  async getTags(@Param('projectId') projectId: string) {
    const tags = await this.service.getDistinctTags(projectId);
    return { tags };
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post() create(@Param('projectId') projectId: string, @Body() dto: CreateModuleDto) {
    return this.service.create(projectId, dto);
  }

  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateModuleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id') @Roles(UserRole.ADMIN, UserRole.ENGINEER) remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
