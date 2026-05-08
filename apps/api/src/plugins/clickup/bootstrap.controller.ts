import { Controller, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  ClickUpBootstrapService,
  type BootstrapDepth,
  type BootstrapScope,
} from './bootstrap.service';

/**
 * "Generate from ClickUp" wizard endpoints.
 *
 *   POST /projects/:projectId/clickup-bootstrap/preview
 *     dry-run; returns the structure that would be created with sample names.
 *
 *   POST /projects/:projectId/clickup-bootstrap
 *     runs the create. Idempotent — re-running picks up only what's new
 *     since the last run (matched on TicketLink.externalId for features and
 *     `from-clickup:<id>` tag for tests).
 */
@ApiTags('plugin-clickup-bootstrap')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ClickUpBootstrapController {
  constructor(private readonly bootstrap: ClickUpBootstrapService) {}

  @Post('projects/:projectId/clickup-bootstrap/preview')
  @ApiOperation({ summary: 'Dry-run: preview the modules/features/tests that would be created' })
  preview(
    @Param('projectId') projectId: string,
    @Body() body: { scope: BootstrapScope; depth: BootstrapDepth },
  ) {
    return this.bootstrap.preview({ projectId, scope: body.scope, depth: body.depth });
  }

  @Post('projects/:projectId/clickup-bootstrap')
  @ApiOperation({ summary: 'Create modules / features / tests from ClickUp (idempotent)' })
  run(
    @Param('projectId') projectId: string,
    @Body() body: { scope: BootstrapScope; depth: BootstrapDepth; tagPrefix?: string },
  ) {
    return this.bootstrap.run({ projectId, scope: body.scope, depth: body.depth, tagPrefix: body.tagPrefix });
  }
}
