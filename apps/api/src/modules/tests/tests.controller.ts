import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { TestsService } from './tests.service';
import { CreateTestDto } from './dto/create-test.dto';
import { UpdateTestDto } from './dto/update-test.dto';
import { QuickMarkDto } from './dto/quick-mark.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('tests') @ApiBearerAuth() @Controller('projects/:projectId/tests')
export class TestsController {
  constructor(private readonly service: TestsService) {}

  @Get() @ApiOperation({ summary: 'List tests for a project' })
  findAll(@Param('projectId') projectId: string, @Query('featureId') featureId?: string) {
    return this.service.findByProject(projectId, featureId);
  }

  @Get(':id') @ApiOperation({ summary: 'Get a test definition' })
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post() @ApiOperation({ summary: 'Create a test definition' })
  create(@Param('projectId') projectId: string, @Body() dto: CreateTestDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(projectId, dto, user.sub);
  }

  @Put(':id') @ApiOperation({ summary: 'Update a test definition' })
  update(@Param('id') id: string, @Body() dto: UpdateTestDto, @CurrentUser() user: JwtPayload) {
    return this.service.update(id, dto, user.sub);
  }

  @Post(':id/duplicate') @ApiOperation({ summary: 'Duplicate a test definition' })
  duplicate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.duplicate(id, user.sub);
  }

  @Post(':id/append-steps')
  @ApiOperation({ summary: 'Append recorder-captured steps to an existing test (used by the test recorder)' })
  appendSteps(
    @Param('id') id: string,
    @Body() body: { steps: Array<Record<string, unknown>>; meta?: { recordedAt?: string; recordedDurationSec?: number } },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.appendSteps(id, body, user.sub);
  }

  @Delete(':id') @Roles(UserRole.ADMIN, UserRole.ENGINEER) @ApiOperation({ summary: 'Archive a test definition' })
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(id, user.sub);
  }

  @Post(':id/restore') @Roles(UserRole.ADMIN, UserRole.ENGINEER) @ApiOperation({ summary: 'Restore a previously archived test definition' })
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.restore(id, user.sub);
  }
}

@ApiTags('tests') @ApiBearerAuth() @Controller('tests')
export class TestsDetailController {
  constructor(private readonly service: TestsService) {}

  @Post(':testDefinitionId/mark')
  @ApiOperation({ summary: 'Quick pass/fail mark — creates a completed TestRun attached to the active work session' })
  quickMark(
    @Param('testDefinitionId') testDefinitionId: string,
    @Body() dto: QuickMarkDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.quickMark(testDefinitionId, dto, user.sub);
  }
}

@ApiTags('tests') @ApiBearerAuth() @Controller('features')
export class FeatureTestStatusController {
  constructor(private readonly service: TestsService) {}

  /**
   * Returns the latest TestRun result per testDefinitionId for a feature.
   * Includes quick-mark, manual, and automated runs — not just FeatureRun-
   * attached results. Optionally filtered by environment.
   */
  @Get(':featureId/test-statuses')
  @ApiOperation({ summary: 'Latest TestRun status per test in a feature' })
  getLatestStatuses(
    @Param('featureId') featureId: string,
    @Query('envId') envId?: string,
  ) {
    return this.service.getLatestTestStatuses(featureId, envId ?? null);
  }
}
