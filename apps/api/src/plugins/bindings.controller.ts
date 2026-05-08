import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../common/prisma/prisma.service';
import { pluginRegistry } from './registry';
import type { PluginCapability } from './types';

const asJson = (v: Record<string, unknown>): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

/**
 * Project / Module / Feature plugin bindings.
 *
 * Bindings carry the per-scope override config that cascades through
 * effective-config (feature → module → project → install.config).
 * Project bindings own status mappings + the enabledCapabilities array;
 * module / feature bindings only carry partial overrides.
 *
 * RBAC: bindings are project-scoped — wiring up the project role guard fully
 * is part of the broader project-RBAC track; for now we lean on JwtAuthGuard
 * + the existing membership checks done at the org/project layer. This will
 * tighten when the bindings UI ships in Phase 2.
 */
@ApiTags('plugin-bindings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class BindingsController {
  constructor(private readonly prisma: PrismaService) {}

  // ── Project bindings ──────────────────────────────────────────────────────

  @Get('projects/:projectId/plugin-bindings')
  @ApiOperation({ summary: 'List project-level plugin bindings' })
  listProjectBindings(@Param('projectId') projectId: string) {
    return this.prisma.projectPluginBinding.findMany({
      where: { projectId, deletedAt: null },
      include: { install: true, statusMappings: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post('projects/:projectId/plugin-bindings')
  @ApiOperation({ summary: 'Create / replace a project binding for an installed plugin' })
  async upsertProjectBinding(
    @Param('projectId') projectId: string,
    @Body()
    body: {
      installId: string;
      bindingConfig: Record<string, unknown>;
      enabledCapabilities?: PluginCapability[];
      autoApplyInboundStatus?: boolean;
      notifyUnmappedStatus?: boolean;
    },
  ) {
    const install = await this.prisma.orgPluginInstall.findUnique({ where: { id: body.installId } });
    if (!install || install.deletedAt) throw new NotFoundException('Install not found');
    const manifest = pluginRegistry.get(install.pluginId);
    if (!manifest) throw new NotFoundException(`Plugin not in registry: ${install.pluginId}`);

    // Filter requested capabilities down to what the manifest actually declares.
    const enabled = (body.enabledCapabilities ?? []).filter((c) => manifest.capabilities.includes(c));

    return this.prisma.projectPluginBinding.upsert({
      where: { projectId_installId: { projectId, installId: install.id } },
      create: {
        orgId: install.orgId,
        projectId,
        installId: install.id,
        bindingConfig: asJson(body.bindingConfig),
        enabledCapabilities: enabled,
        autoApplyInboundStatus: body.autoApplyInboundStatus ?? false,
        notifyUnmappedStatus: body.notifyUnmappedStatus ?? true,
      },
      update: {
        bindingConfig: asJson(body.bindingConfig),
        enabledCapabilities: enabled,
        autoApplyInboundStatus: body.autoApplyInboundStatus,
        notifyUnmappedStatus: body.notifyUnmappedStatus,
        deletedAt: null,
      },
    });
  }

  @Patch('projects/:projectId/plugin-bindings/:id')
  @ApiOperation({ summary: 'Patch a project binding' })
  patchProjectBinding(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      bindingConfig: Record<string, unknown>;
      enabledCapabilities: PluginCapability[];
      autoApplyInboundStatus: boolean;
      notifyUnmappedStatus: boolean;
    }>,
  ) {
    const { bindingConfig, ...rest } = body;
    return this.prisma.projectPluginBinding.update({
      where: { id },
      data: { ...rest, ...(bindingConfig ? { bindingConfig: asJson(bindingConfig) } : {}) },
    });
  }

  @Delete('projects/:projectId/plugin-bindings/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a project binding' })
  async deleteProjectBinding(@Param('id') id: string) {
    await this.prisma.projectPluginBinding.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Status mappings (bulk-replace) ───────────────────────────────────────

  @Get('projects/:projectId/plugin-bindings/:id/status-mappings')
  @ApiOperation({ summary: 'List status mappings on a project binding' })
  listStatusMappings(@Param('id') id: string) {
    return this.prisma.pluginStatusMapping.findMany({
      where: { bindingId: id },
      orderBy: [{ direction: 'asc' }, { platformValue: 'asc' }],
    });
  }

  @Put('projects/:projectId/plugin-bindings/:id/status-mappings')
  @ApiOperation({ summary: 'Bulk-replace status mappings on a project binding' })
  async replaceStatusMappings(
    @Param('id') id: string,
    @Body()
    body: {
      mappings: Array<{
        direction: 'OUTBOUND' | 'INBOUND' | 'BIDIRECTIONAL';
        targetType: 'PHASE' | 'ISSUE_STATUS';
        platformValue: string;
        externalValue: string;
      }>;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.pluginStatusMapping.deleteMany({ where: { bindingId: id } });
      if (body.mappings.length > 0) {
        await tx.pluginStatusMapping.createMany({
          data: body.mappings.map((m) => ({
            bindingId: id,
            direction: m.direction,
            targetType: m.targetType,
            platformValue: m.platformValue,
            externalValue: m.externalValue,
          })),
        });
      }
      return tx.pluginStatusMapping.findMany({
        where: { bindingId: id },
        orderBy: [{ direction: 'asc' }, { platformValue: 'asc' }],
      });
    });
  }

  // ── Module bindings ───────────────────────────────────────────────────────

  @Get('modules/:moduleId/plugin-bindings')
  listModuleBindings(@Param('moduleId') moduleId: string) {
    return this.prisma.modulePluginBinding.findMany({
      where: { moduleId, deletedAt: null },
      include: { install: true },
    });
  }

  @Post('modules/:moduleId/plugin-bindings')
  upsertModuleBinding(
    @Param('moduleId') moduleId: string,
    @Body() body: { installId: string; bindingConfig: Record<string, unknown> },
  ) {
    return this.prisma.modulePluginBinding.upsert({
      where: { moduleId_installId: { moduleId, installId: body.installId } },
      create: { moduleId, installId: body.installId, bindingConfig: asJson(body.bindingConfig) },
      update: { bindingConfig: asJson(body.bindingConfig), deletedAt: null },
    });
  }

  @Delete('modules/:moduleId/plugin-bindings/:id')
  @HttpCode(204)
  async deleteModuleBinding(@Param('id') id: string) {
    await this.prisma.modulePluginBinding.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Feature bindings ──────────────────────────────────────────────────────

  @Get('features/:featureId/plugin-bindings')
  listFeatureBindings(@Param('featureId') featureId: string) {
    return this.prisma.featurePluginBinding.findMany({
      where: { featureId, deletedAt: null },
      include: { install: true },
    });
  }

  @Post('features/:featureId/plugin-bindings')
  upsertFeatureBinding(
    @Param('featureId') featureId: string,
    @Body() body: { installId: string; bindingConfig: Record<string, unknown> },
  ) {
    return this.prisma.featurePluginBinding.upsert({
      where: { featureId_installId: { featureId, installId: body.installId } },
      create: { featureId, installId: body.installId, bindingConfig: asJson(body.bindingConfig) },
      update: { bindingConfig: asJson(body.bindingConfig), deletedAt: null },
    });
  }

  @Delete('features/:featureId/plugin-bindings/:id')
  @HttpCode(204)
  async deleteFeatureBinding(@Param('id') id: string) {
    await this.prisma.featurePluginBinding.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
