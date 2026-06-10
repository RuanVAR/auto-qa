import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RunSessionStatus } from '@prisma/client';
import { TestRunSessionsService } from './test-run-sessions.service';
import { CreateTestRunSessionDto, GenerateRunReportDto } from './dto/create-test-run-session.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { clampLimit } from '../../common/util/pagination';

@ApiTags('test-run-sessions')
@ApiBearerAuth()
@Controller()
export class TestRunSessionsController {
  constructor(private readonly service: TestRunSessionsService) {}

  @Post('projects/:projectId/test-run-sessions')
  @ApiOperation({ summary: 'Start a named manual test run' })
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateTestRunSessionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(projectId, dto, user);
  }

  @Get('projects/:projectId/test-run-sessions')
  @ApiOperation({ summary: 'List manual test runs for a project (table view)' })
  list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: RunSessionStatus,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    return this.service.list(projectId, user, {
      status,
      limit: clampLimit(limit, { def: 50, max: 100 }),
      page: page ? Number(page) : 1,
    });
  }

  @Get('test-run-sessions/:id')
  @ApiOperation({ summary: 'Get a manual test run with its results + bugs' })
  get(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.get(id, user);
  }

  @Post('test-run-sessions/:id/finish')
  @ApiOperation({ summary: 'Finish a manual test run (stamps end time + duration)' })
  finish(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.finish(id, user);
  }

  @Post('test-run-sessions/:id/abandon')
  @ApiOperation({ summary: 'Abandon a manual test run' })
  abandon(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.abandon(id, user);
  }

  @Post('test-run-sessions/:id/heartbeat')
  @ApiOperation({ summary: 'Keep an active run alive (anti-stale)' })
  heartbeat(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.heartbeat(id, user);
  }

  @Post('test-run-sessions/:id/report')
  @ApiOperation({ summary: 'Generate (and optionally email) a report for this run' })
  report(
    @Param('id') id: string,
    @Body() dto: GenerateRunReportDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.generateReport(id, user, dto);
  }
}
