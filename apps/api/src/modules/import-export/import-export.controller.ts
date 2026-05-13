import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { ImportExportService, ExportEnvelope } from './import-export.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('import-export')
@ApiBearerAuth()
@Controller()
export class ImportExportController {
  constructor(private readonly service: ImportExportService) {}

  // ── EXPORT ─────────────────────────────────────────────────────────────────

  @Get('projects/:id/export')
  @ApiOperation({ summary: 'Export entire project as JSON' })
  async exportProject(@Param('id') id: string, @Res() reply: FastifyReply) {
    const data = await this.service.exportProject(id);
    void reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="project-export-${new Date().toISOString().slice(0, 10)}.json"`)
      .send(JSON.stringify(data, null, 2));
  }

  @Get('modules/:id/export')
  @ApiOperation({ summary: 'Export a module as JSON' })
  async exportModule(@Param('id') id: string, @Res() reply: FastifyReply) {
    const data = await this.service.exportModule(id);
    void reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="module-export-${new Date().toISOString().slice(0, 10)}.json"`)
      .send(JSON.stringify(data, null, 2));
  }

  @Get('features/:id/export')
  @ApiOperation({ summary: 'Export a feature as JSON' })
  async exportFeature(@Param('id') id: string, @Res() reply: FastifyReply) {
    const data = await this.service.exportFeature(id);
    void reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="feature-export-${new Date().toISOString().slice(0, 10)}.json"`)
      .send(JSON.stringify(data, null, 2));
  }

  @Get('tests/:id/export')
  @ApiOperation({ summary: 'Export a single test case as JSON' })
  async exportTestCase(@Param('id') id: string, @Res() reply: FastifyReply) {
    const data = await this.service.exportTestCase(id);
    void reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="testcase-export-${new Date().toISOString().slice(0, 10)}.json"`)
      .send(JSON.stringify(data, null, 2));
  }

  // ── FEATURE-LEVEL IMPORT ────────────────────────────────────────────────────

  @Post('features/import')
  @ApiOperation({ summary: 'Import a feature JSON into a module' })
  @ApiQuery({ name: 'moduleId', required: true, description: 'Target module to place the imported feature in' })
  async importFeature(
    @Query('moduleId') moduleId: string,
    @Body() body: ExportEnvelope,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!moduleId) throw new BadRequestException('moduleId query parameter is required');
    return this.service.importFeatureIntoModule(moduleId, body, user?.sub);
  }

  @Post('features/:featureId/import-merge')
  @ApiOperation({
    summary: 'Merge a feature export INTO an existing feature',
    description:
      'Upserts tests by name within the target feature. Existing tests are ' +
      'snapshotted (label "Before merge-import") and updated. Tests not yet ' +
      'in the feature are created. Tests already in the feature but not in ' +
      'the envelope are LEFT UNTOUCHED — this is merge, not replace.',
  })
  async importMergeIntoFeature(
    @Param('featureId') featureId: string,
    @Body() body: ExportEnvelope,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.mergeIntoFeature(featureId, body, { importedById: user?.sub });
  }

  // ── IMPORT PREVIEW (dry-run, no side-effects) ───────────────────────────────

  @Post('projects/:id/import/preview')
  @ApiOperation({ summary: 'Preview what an import would create — includes conflict list' })
  async previewImport(
    @Param('id') projectId: string,
    @Body() body: ExportEnvelope & { targetModuleId?: string; targetFeatureId?: string },
  ) {
    const { targetModuleId, targetFeatureId, ...envelope } = body;
    return this.service.previewImport(projectId, envelope as ExportEnvelope, { targetModuleId, targetFeatureId });
  }

  // ── IMPORT ─────────────────────────────────────────────────────────────────

  @Post('projects/:id/import')
  @ApiOperation({ summary: 'Import any export level into a project (with optional selection filter)' })
  async importIntoProject(
    @Param('id') projectId: string,
    @Body() body: ExportEnvelope & { targetModuleId?: string; targetFeatureId?: string; selection?: string[] },
    @CurrentUser() user: JwtPayload,
  ) {
    const { targetModuleId, targetFeatureId, selection, ...envelope } = body;
    return this.service.importIntoProject(projectId, envelope as ExportEnvelope, {
      targetModuleId,
      targetFeatureId,
      selection,
      importedById: user?.sub,
    });
  }

  // ── IMPORT HISTORY ─────────────────────────────────────────────────────────

  @Get('projects/:id/import-logs')
  @ApiOperation({ summary: 'List import history for a project' })
  async listImportLogs(@Param('id') projectId: string) {
    return this.service.listImportLogs(projectId);
  }

  // ── TEST CASE VERSION HISTORY ──────────────────────────────────────────────

  @Get('tests/:id/versions')
  @ApiOperation({ summary: 'List snapshot history for a test case (max 5)' })
  async listTestVersions(@Param('id') testId: string) {
    return this.service.listTestVersions(testId);
  }

  @Post('tests/:id/versions/:versionId/restore')
  @ApiOperation({ summary: 'Restore a test case to a previous snapshot' })
  async restoreTestVersion(
    @Param('id') testId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.service.restoreTestVersion(testId, versionId);
  }

  // ── MODULE VERSION HISTORY ─────────────────────────────────────────────────

  @Get('modules/:id/versions')
  @ApiOperation({ summary: 'List snapshot history for a module (max 5)' })
  async listModuleVersions(@Param('id') moduleId: string) {
    return this.service.listModuleVersions(moduleId);
  }

  @Post('modules/:id/versions/:versionId/restore')
  @ApiOperation({ summary: 'Restore a module to a previous snapshot' })
  async restoreModuleVersion(
    @Param('id') moduleId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.service.restoreModuleVersion(moduleId, versionId);
  }
}
