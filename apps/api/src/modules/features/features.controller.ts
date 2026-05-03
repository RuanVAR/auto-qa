import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FeaturesService } from './features.service';
import { StatsService } from '../stats/stats.service';
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('features') @ApiBearerAuth()
@Controller('modules/:moduleId/features')
export class FeaturesController {
  constructor(
    private readonly service: FeaturesService,
    private readonly statsService: StatsService,
  ) {}

  @Get() @ApiOperation({ summary: 'List features for a module' })
  findAll(@Param('moduleId') moduleId: string) {
    return this.service.findByModule(moduleId);
  }

  @Get('stats') @ApiOperation({ summary: 'Get stats for all features in a module' })
  getStats(@Param('moduleId') moduleId: string) {
    return this.statsService.computeFeatureStatsForModule(moduleId);
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Get(':id/draft-status') draftStatus(@Param('id') id: string) {
    return this.service.getDraftStatus(id);
  }

  @Post() create(@Param('moduleId') moduleId: string, @Body() dto: CreateFeatureDto) {
    return this.service.create(moduleId, dto);
  }

  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateFeatureDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id') @Roles(UserRole.ADMIN, UserRole.ENGINEER) remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

/** Standalone feature lookup — used by FeaturePage which only knows the featureId, not the moduleId */
@ApiTags('features') @ApiBearerAuth() @Controller('features')
export class FeatureDetailController {
  constructor(
    private readonly service: FeaturesService,
    private readonly statsService: StatsService,
  ) {}

  @Get(':id') @ApiOperation({ summary: 'Get a single feature by ID' })
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Get(':id/stats') @ApiOperation({ summary: 'Get stats for a single feature' })
  getStats(@Param('id') id: string) { return this.statsService.computeFeatureStats(id); }

  @Get(':id/draft-status') @ApiOperation({ summary: 'Get draft/publish status for a feature' })
  draftStatus(@Param('id') id: string) { return this.service.getDraftStatus(id); }

  @Put(':id') @ApiOperation({ summary: 'Update a feature by ID' })
  update(@Param('id') id: string, @Body() dto: UpdateFeatureDto) { return this.service.update(id, dto); }

  @Delete(':id') @Roles(UserRole.ADMIN, UserRole.ENGINEER) @ApiOperation({ summary: 'Delete a feature by ID' })
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
