import { Controller, Get, Put, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { FeatureSpecService } from './feature-spec.service';

@ApiTags('feature-spec')
@ApiBearerAuth()
@Controller('features/:featureId/spec')
export class FeatureSpecController {
  constructor(private readonly service: FeatureSpecService) {}

  @Get()
  @ApiOperation({ summary: 'Get the feature spec (describe/it DSL) for its test definitions' })
  getSpec(@Param('featureId') featureId: string) {
    return this.service.getSpec(featureId);
  }

  @Post('validate')
  @ApiOperation({ summary: 'Validate spec text without saving' })
  validate(@Body() body: { text: string }) {
    return this.service.validate(body?.text ?? '');
  }

  @Put()
  @ApiOperation({ summary: 'Save spec text — syncs the feature\'s test definitions to match' })
  sync(
    @Param('featureId') featureId: string,
    @Body() body: { text: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.syncSpec(featureId, body?.text ?? '', user?.sub);
  }
}
