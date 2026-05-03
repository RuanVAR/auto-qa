import { Controller, Get, Post, Patch, Param, Body, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FeatureVersionsService, PublishVersionDto } from './feature-versions.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('feature-versions') @ApiBearerAuth()
@Controller('features/:featureId/versions')
export class FeatureVersionsController {
  constructor(private readonly service: FeatureVersionsService) {}

  @Get() @ApiOperation({ summary: 'List all versions for a feature' })
  findAll(@Param('featureId') featureId: string) {
    return this.service.findByFeature(featureId);
  }

  @Get(':versionId') findOne(
    @Param('featureId') featureId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.service.findOne(featureId, versionId);
  }

  @Get(':versionId/diff') diff(
    @Param('featureId') featureId: string,
    @Param('versionId') versionId: string,
    @Query('compareTo') compareToId: string,
  ) {
    return this.service.diff(featureId, versionId, compareToId);
  }

  @Post() @ApiOperation({ summary: 'Publish current draft as a new version' })
  publish(
    @Param('featureId') featureId: string,
    @Body() dto: PublishVersionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.publish(featureId, dto, user.sub);
  }

  @Post(':versionId/restore') @ApiOperation({ summary: 'Restore feature to a previous version' })
  restore(
    @Param('featureId') featureId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.service.restore(featureId, versionId);
  }

  @Patch('active') @ApiOperation({ summary: 'Set a version as active' })
  setActive(
    @Param('featureId') featureId: string,
    @Body('versionId') versionId: string,
  ) {
    return this.service.setActive(featureId, versionId);
  }
}
