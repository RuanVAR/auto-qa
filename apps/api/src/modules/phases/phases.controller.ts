import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { PhaseRole, PhaseStatus } from '@prisma/client';
import { PhasesService } from './phases.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

class CreatePhaseDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() order?: number;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsBoolean() autoPromote?: boolean;
  @IsOptional() @IsString() environmentId?: string;
  @IsOptional() @IsArray() handoverRecipients?: string[];
}

class UpdatePhaseDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() order?: number;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsBoolean() autoPromote?: boolean;
  @IsOptional() @IsString() environmentId?: string;
  @IsOptional() @IsArray() handoverRecipients?: string[];
}

class AssignDto {
  @IsString() userId!: string;
  @IsEnum(PhaseRole) role!: PhaseRole;
}

class SetStatusDto {
  @IsEnum(PhaseStatus) status!: PhaseStatus;
  @IsOptional() @IsString() notes?: string;
}

class PromoteDto {
  @IsOptional() @IsString() notes?: string;
}

@ApiTags('phases') @ApiBearerAuth()
@Controller()
export class PhasesController {
  constructor(private readonly service: PhasesService) {}

  // ─── ProjectPhase ────────────────────────────────────────────────────

  @Get('projects/:projectId/phases')
  @ApiOperation({ summary: 'List a project\'s phase pipeline' })
  list(@Param('projectId') projectId: string) {
    return this.service.listForProject(projectId);
  }

  @Post('projects/:projectId/phases')
  @ApiOperation({ summary: 'Create a phase (e.g. "QA Testing", "UAT")' })
  create(@Param('projectId') projectId: string, @Body() dto: CreatePhaseDto) {
    return this.service.create(projectId, dto);
  }

  @Post('projects/:projectId/phases/reorder')
  @ApiOperation({ summary: 'Replace the full phase order with the given id list' })
  reorder(@Param('projectId') projectId: string, @Body() dto: { orderedIds: string[] }) {
    return this.service.reorder(projectId, dto.orderedIds);
  }

  @Patch('phases/:phaseId')
  @ApiOperation({ summary: 'Update a phase' })
  update(@Param('phaseId') phaseId: string, @Body() dto: UpdatePhaseDto) {
    return this.service.update(phaseId, dto);
  }

  @Delete('phases/:phaseId')
  @ApiOperation({ summary: 'Delete a phase (only if no features sit in it)' })
  remove(@Param('phaseId') phaseId: string) {
    return this.service.remove(phaseId);
  }

  // ─── PhaseAssignment ─────────────────────────────────────────────────

  @Post('phases/:phaseId/assignments')
  @ApiOperation({ summary: 'Assign a user to a phase as TESTER / MANAGER / VIEWER' })
  assign(@Param('phaseId') phaseId: string, @Body() dto: AssignDto) {
    return this.service.assignUser(phaseId, dto);
  }

  @Delete('phases/:phaseId/assignments/:userId')
  @ApiOperation({ summary: 'Unassign a user from a phase' })
  unassign(@Param('phaseId') phaseId: string, @Param('userId') userId: string) {
    return this.service.unassignUser(phaseId, userId);
  }

  // ─── FeaturePhase ────────────────────────────────────────────────────

  @Get('features/:featureId/phases')
  @ApiOperation({ summary: 'List the feature\'s position in each project phase' })
  async listFeaturePhases(
    @Param('featureId') featureId: string,
    @Query('autoCreate') autoCreate?: string,
  ) {
    // ?autoCreate=1 lazily materialises FeaturePhase rows for any phase that
    // doesn't have one yet — so a feature added after phases are configured
    // immediately has tracking rows.
    if (autoCreate === '1') {
      return this.service.ensureFeaturePhases(featureId);
    }
    return this.service.listFeaturePhases(featureId);
  }

  @Post('feature-phases/:id/start')
  @ApiOperation({ summary: 'Begin testing in this phase (PENDING → IN_PROGRESS)' })
  start(@Param('id') id: string) {
    return this.service.start(id);
  }

  @Post('feature-phases/:id/status')
  @ApiOperation({ summary: 'Set phase status (e.g. PASSED, FAILED, BLOCKED, SKIPPED)' })
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.service.setStatus(id, dto.status, dto.notes);
  }

  @Post('feature-phases/:id/promote')
  @ApiOperation({ summary: 'Promote feature out of this phase into the next' })
  promote(@Param('id') id: string, @Body() dto: PromoteDto, @CurrentUser() user: JwtPayload) {
    return this.service.promoteFeaturePhase(id, user.sub, dto.notes);
  }

  // ─── Terminal sign-off ───────────────────────────────────────────────

  @Post('features/:featureId/sign-off')
  @ApiOperation({ summary: 'Record terminal manager sign-off after all phases pass' })
  signOff(
    @Param('featureId') featureId: string,
    @Body() dto: { message?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.signOffFeature(featureId, user.sub, dto.message);
  }

  @Get('features/:featureId/sign-off')
  @ApiOperation({ summary: 'Get terminal sign-off for a feature (null if not signed off)' })
  getSignOff(@Param('featureId') featureId: string) {
    return this.service.getFeatureSignOff(featureId);
  }
}
