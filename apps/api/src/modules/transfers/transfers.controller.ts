import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TransfersService } from './transfers.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRoleGuard, OrgRoles } from '../../common/guards/org-role.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { ValidateCodeDto } from './dto/validate-code.dto';
import { ReviewTransferDto } from './dto/review-transfer.dto';
import { SetAcceptsTransfersDto } from './dto/set-accepts-transfers.dto';

/**
 * Project transfer between organisations.
 *
 * Authorization shape — every route here is ORG_ADMIN-only, but on two
 * different orgs, and getting that backwards is the whole risk of the feature:
 *
 *   - `projects/:projectId/transfer*` is the SENDING side. There is no `:orgId`
 *     in the path, so `OrgRoleGuard` cannot help (it only reads
 *     `request.params.orgId`). These routes call `assertOrgAdminOfProject`,
 *     which resolves the caller's LIVE role against the project's OWN org from
 *     the database — not from the JWT's `orgRole`/`activeOrgId`, which say what
 *     the caller is somewhere, not that it is here.
 *
 *   - `orgs/:orgId/transfers*` is the RECEIVING side and does carry `:orgId`,
 *     so `OrgRoleGuard` + `@OrgRoles('ORG_ADMIN')` applies, and the service
 *     re-checks that each request actually targets that `:orgId` before acting.
 *
 * Requests are addressed by id under their org's path rather than by a global
 * `/transfers/:id`, so a request id alone is never enough to act on it.
 */
@ApiTags('transfers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRoleGuard)
@Controller()
export class TransfersController {
  constructor(
    private readonly service: TransfersService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The caller must be an ORG_ADMIN of the org that currently owns the project.
   *
   * Deliberately DB-backed: `user.orgRole === 'ORG_ADMIN'` only means the caller
   * is an admin of their active org. Trusting it here would let an admin of any
   * org transfer any other org's project away.
   */
  private async assertOrgAdminOfProject(projectId: string, user: JwtPayload): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project?.orgId) throw new NotFoundException('Project not found');

    if (user.platformRole === 'PLATFORM_ADMIN') return project.orgId;

    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: project.orgId, userId: user.sub } },
      select: { role: true },
    });
    // 404, not 403 — a non-member must not learn that this project exists.
    if (!membership) throw new NotFoundException('Project not found');
    if (membership.role !== 'ORG_ADMIN') {
      throw new ForbiddenException('Only organisation admins can transfer a project');
    }
    return project.orgId;
  }

  // ── Sending side: projects/:projectId/transfer ────────────────────────────

  /**
   * Resolve an org code to a name so the admin can confirm the destination
   * before committing. Rate-limited: this is the one endpoint that maps a
   * guessable secret onto "which org is this", and without a limit it would be
   * an org-enumeration oracle.
   */
  @Post('projects/:projectId/transfer/validate-code')
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Check an organisation transfer code (ORG_ADMIN of the project’s org)' })
  async validateCode(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ValidateCodeDto,
  ) {
    await this.assertOrgAdminOfProject(projectId, user);
    return this.service.validateCode(projectId, dto, user.sub);
  }

  @Post('projects/:projectId/transfer/preview')
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Preview what a transfer to this code would do' })
  async preview(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ValidateCodeDto,
  ) {
    await this.assertOrgAdminOfProject(projectId, user);
    return this.service.previewTransfer(projectId, dto);
  }

  @Post('projects/:projectId/transfer')
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a transfer of this project to another organisation' })
  async request(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTransferDto,
  ) {
    await this.assertOrgAdminOfProject(projectId, user);
    return this.service.createRequest(projectId, user.sub, dto);
  }

  @Get('projects/:projectId/transfers')
  @ApiOperation({ summary: 'Transfer history for a project' })
  async listForProject(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    await this.assertOrgAdminOfProject(projectId, user);
    return this.service.listForProject(projectId);
  }

  @Delete('projects/:projectId/transfers/:id')
  @ApiOperation({ summary: 'Withdraw a pending transfer request' })
  async cancel(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertOrgAdminOfProject(projectId, user);
    return this.service.cancelRequest(projectId, id, user.sub);
  }

  // ── Receiving side: orgs/:orgId/transfers ─────────────────────────────────

  @Get('orgs/:orgId/transfers')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'List transfers in/out of this organisation (ORG_ADMIN only)' })
  @ApiQuery({ name: 'direction', required: false, enum: ['in', 'out', 'all'] })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'] })
  listForOrg(
    @Param('orgId') orgId: string,
    @Query('direction') direction?: 'in' | 'out' | 'all',
    @Query('status') status?: string,
  ) {
    return this.service.listForOrg(orgId, direction ?? 'all', status);
  }

  @Get('orgs/:orgId/transfers/:id')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Review an incoming transfer, with its current impact (ORG_ADMIN only)' })
  getForReview(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.service.getForReview(id, orgId);
  }

  @Post('orgs/:orgId/transfers/:id/accept')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Accept an incoming transfer — moves the project immediately' })
  accept(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReviewTransferDto,
  ) {
    return this.service.accept(id, orgId, user.sub, dto);
  }

  @Post('orgs/:orgId/transfers/:id/reject')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Decline an incoming transfer' })
  reject(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReviewTransferDto,
  ) {
    return this.service.reject(id, orgId, user.sub, dto);
  }

  // ── The org's own transfer code ───────────────────────────────────────────

  @Get('orgs/:orgId/transfer-code')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: "This organisation's transfer code (ORG_ADMIN only)" })
  getCode(@Param('orgId') orgId: string) {
    return this.service.getCode(orgId);
  }

  @Post('orgs/:orgId/transfer-code/rotate')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Rotate the transfer code — the previous code stops working' })
  rotateCode(@Param('orgId') orgId: string) {
    return this.service.rotateCode(orgId);
  }

  @Patch('orgs/:orgId/transfer-settings')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Turn incoming transfers on/off for this organisation' })
  setAcceptsTransfers(@Param('orgId') orgId: string, @Body() dto: SetAcceptsTransfersDto) {
    return this.service.setAcceptsTransfers(orgId, dto.acceptsTransfers);
  }
}
