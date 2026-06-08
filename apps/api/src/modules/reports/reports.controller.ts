import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportType, ReportFormat } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import { ReportsService } from './reports.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { EnvAccessService } from '../../common/access/env-access.service';

class GenerateReportDto {
  @IsOptional() @IsString() configId?: string;
  @IsEnum(ReportType) type!: ReportType;
  @IsOptional() @IsString() featureId?: string;
  @IsOptional() @IsString() moduleId?: string;
  @IsOptional() @IsString() phaseId?: string;
  @IsOptional() @IsString() workSessionId?: string;
  @IsOptional() @IsString() environmentId?: string;
  @IsOptional() @IsBoolean() includeSession?: boolean;
  @IsOptional() @IsBoolean() includeFeature?: boolean;
  @IsOptional() @IsBoolean() includeProject?: boolean;
  @IsOptional() @IsBoolean() includeCharts?: boolean;
  /** Include the per-test pass/fail/bug list for the scoped feature(s) /
   *  module / session. Defaults true. */
  @IsOptional() @IsBoolean() includeTests?: boolean;
  /** Legacy — reports now always render to PDF. Accepted but ignored. */
  @IsOptional() @IsEnum(ReportFormat) format?: ReportFormat;
  /** Optional list of email addresses to deliver the rendered report to.
   *  Empty / omitted = generate-only (no email). Each entry validated as
   *  email; invalid entries are dropped server-side, never block the request. */
  @IsOptional() @IsArray() @IsEmail({}, { each: true }) recipientEmails?: string[];
  @IsOptional() @IsString() @MaxLength(5000) additionalText?: string;
  /** Active filter spec from a list view — adds a "Filtered tests" section. */
  @IsOptional() appliedFilters?: {
    search?: string; tags?: string[]; epics?: string[];
    moduleId?: string; featureId?: string;
    status?: 'PASSED' | 'FAILED' | 'OUTSTANDING';
  };
}

class CreateConfigDto extends GenerateReportDto {
  @IsString() name!: string;
}

@ApiTags('reports') @ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(
    private readonly service: ReportsService,
    private readonly envAccess: EnvAccessService,
  ) {}

  /** Object-level authz for a report's project — was an IDOR on the bare
   *  report :id endpoints (any user could read/delete any report across orgs). */
  private async assertReportProjectAccess(projectId: string, user: JwtPayload): Promise<void> {
    await this.envAccess.assertProjectAccess(user.sub, projectId, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
      orgId: user.activeOrgId,
    });
  }

  // ─── Configs (saved templates) ───────────────────────────────────────

  @Get('projects/:projectId/report-configs')
  @ApiOperation({ summary: 'List saved report templates' })
  listConfigs(@Param('projectId') projectId: string) {
    return this.service.listConfigs(projectId);
  }

  @Post('projects/:projectId/report-configs')
  @ApiOperation({ summary: 'Save a reusable report template' })
  createConfig(
    @Param('projectId') projectId: string,
    @Body() dto: CreateConfigDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createConfig(projectId, user.sub, { ...dto, projectId });
  }

  @Delete('report-configs/:id')
  @ApiOperation({ summary: 'Delete a saved report template' })
  async deleteConfig(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.assertReportProjectAccess(await this.service.getProjectIdForConfig(id), user);
    return this.service.deleteConfig(id);
  }

  // ─── On-demand generation ────────────────────────────────────────────

  @Post('projects/:projectId/reports/generate')
  @ApiOperation({ summary: 'Generate a report (HTML or PDF) immediately' })
  generate(
    @Param('projectId') projectId: string,
    @Body() dto: GenerateReportDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.generate(user.sub, { ...dto, projectId });
  }

  // ─── Generated history ───────────────────────────────────────────────

  @Get('projects/:projectId/reports')
  @ApiOperation({ summary: 'List generated reports' })
  listGenerated(
    @Param('projectId') projectId: string,
    @Query('type') type?: ReportType,
    @Query('environmentId') environmentId?: string,
    @Query('moduleId') moduleId?: string,
    @Query('featureId') featureId?: string,
    @Query('limit') limit?: string,
  ) {
    // Cascade-aware: featureId narrows to one feature; moduleId includes all
    // features under that module; neither = full project history.
    return this.service.listGenerated(projectId, {
      type, environmentId, moduleId, featureId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('projects/:projectId/reports/latest')
  @ApiOperation({
    summary: 'Latest report at a given scope',
    description: 'Single most recent GeneratedReport for the requested scope (project / module / feature). ' +
                 'Powers the LatestReportCard widget on module + feature pages.',
  })
  latest(
    @Param('projectId') projectId: string,
    @Query('moduleId') moduleId?: string,
    @Query('featureId') featureId?: string,
  ) {
    return this.service.getLatest(projectId, { moduleId, featureId });
  }

  @Get('projects/:projectId/report-default-recipients')
  @ApiOperation({
    summary: 'Default recipients for the Generate-and-Email modal',
    description: 'Returns ORG_ADMINs + project OWNER/TECH_LEAD/MANAGER members to ' +
                 'pre-populate the recipients chip input. Deduplicated by email; ' +
                 'deactivated/suspended users excluded.',
  })
  defaultRecipients(@Param('projectId') projectId: string) {
    return this.service.getDefaultRecipients(projectId);
  }

  @Get('reports/:id') @ApiOperation({ summary: 'Get report metadata + frozen payload' })
  async get(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.assertReportProjectAccess(await this.service.getProjectIdForGenerated(id), user);
    return this.service.getGenerated(id);
  }

  /**
   * Stream the rendered artifact (HTML or PDF). `?inline=1` makes browsers
   * render in the tab; without it the file downloads as an attachment.
   */
  @Get('reports/:id/download')
  @ApiOperation({ summary: 'Download the rendered report artifact' })
  async download(
    @Param('id') id: string,
    @Query('inline') inline: string | undefined,
    @Res() reply: FastifyReply,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertReportProjectAccess(await this.service.getProjectIdForGenerated(id), user);
    const r = await this.service.getGenerated(id);
    const opened = await this.service.openArtifact(r);
    if (!opened) {
      reply.code(404).send({ message: 'Report artifact missing' });
      return;
    }
    reply.headers({
      'Content-Type': opened.mimeType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${opened.filename}"`,
    });
    reply.send(await opened.streamFull());
  }

  /**
   * In-app HTML preview. Reports are delivered as PDF (download + email);
   * the HTML is regenerated on demand from the report's frozen payload so
   * the preview is instant and always available — even before the PDF
   * worker finishes, and for historical reports with no HTML on disk.
   */
  @Get('reports/:id/preview')
  @ApiOperation({ summary: 'Render the report as HTML for in-app preview' })
  async preview(@Param('id') id: string, @Res() reply: FastifyReply, @CurrentUser() user: JwtPayload) {
    await this.assertReportProjectAccess(await this.service.getProjectIdForGenerated(id), user);
    const r = await this.service.getGenerated(id);
    const html = this.service.renderStoredHtml(r);
    reply.headers({ 'Content-Type': 'text/html; charset=utf-8' });
    reply.send(html);
  }
}
