import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { EnvAccessService } from '../../common/access/env-access.service';
import { accessCtx } from '../../common/access/access-context';
import { DefectsService, CreateDefectInput } from './defects.service';

@ApiTags('defects') @ApiBearerAuth() @Controller('projects/:projectId/defects')
export class DefectsController {
  constructor(private readonly defects: DefectsService, private readonly envAccess: EnvAccessService) {}

  @Get() async list(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, accessCtx(user));
    return this.defects.list(projectId);
  }

  @Post() @ApiOperation({ summary: 'Create a reusable failure-defect matching rule' })
  async create(@Param('projectId') projectId: string, @Body() input: CreateDefectInput, @CurrentUser() user: JwtPayload) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, accessCtx(user));
    return this.defects.create(projectId, input, user.sub);
  }

  @Patch(':id')
  async update(@Param('projectId') projectId: string, @Param('id') id: string, @Body() input: Partial<CreateDefectInput>, @CurrentUser() user: JwtPayload) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, accessCtx(user));
    return this.defects.update(id, projectId, input);
  }
}
