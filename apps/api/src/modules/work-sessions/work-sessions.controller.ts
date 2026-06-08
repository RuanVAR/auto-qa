import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  forwardRef,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { WorkSessionsService } from './work-sessions.service';
import { FeatureRunsService } from '../feature-runs/feature-runs.service';
import { EndSessionDto } from './dto/end-session.dto';
import { ListSessionsDto } from './dto/list-sessions.dto';

@ApiTags('work-sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('work-sessions')
export class WorkSessionsController {
  constructor(
    private readonly service: WorkSessionsService,
    // forwardRef — WorkSessionsModule and FeatureRunsModule import each other.
    @Inject(forwardRef(() => FeatureRunsService))
    private readonly featureRuns: FeatureRunsService,
  ) {}

  @Get('current')
  @ApiOperation({ summary: 'Get the current active work session with stats + breakdown' })
  async current(@CurrentUser() user: JwtPayload) {
    const orgId = user.activeOrgId;
    if (!orgId) return null;
    return this.service.getCurrentWithStats(user.sub, orgId);
  }

  @Post('end')
  @ApiOperation({ summary: 'End the current active work session (and any active manual runs)' })
  async endCurrent(@CurrentUser() user: JwtPayload, @Body() dto: EndSessionDto) {
    const orgId = user.activeOrgId;
    if (!orgId) return null;
    const reason = dto.reason ?? 'manual';
    // Couple the two: ending the QA work session also abandons every active
    // manual FeatureRun for this user. Before this, the badge said "ended"
    // while a manual run kept running — "stop" never fully stopped.
    // abandon() itself closes the work session, so this is also what makes
    // the operation idempotent end-to-end.
    await this.featureRuns.endAllActiveManualForUser(user.sub, reason).catch(() => { /* non-fatal */ });
    return this.service.endActive(user.sub, orgId, reason);
  }

  @Get('last')
  @ApiOperation({ summary: 'Get the most recent ended session for the current user' })
  async last(@CurrentUser() user: JwtPayload) {
    const orgId = user.activeOrgId;
    if (!orgId) return null;
    return this.service.getLastSessionForUser(user.sub, orgId);
  }

  @Get()
  @ApiOperation({ summary: 'Paginated history of work sessions for the current user' })
  async list(@CurrentUser() user: JwtPayload, @Query() query: ListSessionsDto) {
    const orgId = user.activeOrgId;
    if (!orgId) return { items: [], total: 0, page: 1, limit: 20, pages: 0 };
    return this.service.listHistory(user.sub, orgId, query.page ?? 1, query.limit ?? 20);
  }

  @Get(':id/breakdown')
  @ApiOperation({ summary: 'Module/feature breakdown for a given session' })
  async breakdown(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getBreakdown(id, user.sub);
  }
}
