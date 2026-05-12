import {
  Controller, Get, Post, Put, Delete, Patch,
  Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { CreateConfigDto } from './dto/create-config.dto';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { UserRole, AccountStatus, PlatformRole } from '@prisma/client';
import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean } from 'class-validator';

class UpdateConfigBodyDto { @IsString() @IsNotEmpty() value!: string; }
class UpdateUserDto {
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsEnum(AccountStatus) accountStatus?: AccountStatus;
  @IsOptional() @IsEnum(PlatformRole) platformRole?: PlatformRole;
}
class ApprovalActionDto {
  @IsOptional() @IsString() note?: string;
}
class UpdateOrgStatusDto {
  @IsBoolean() isActive!: boolean;
}
class InvitePlatformAdminDto {
  @IsString() @IsNotEmpty() email!: string;
  @IsOptional() @IsString() name?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) {}

  // ── Platform Stats ──────────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Get platform-wide stats' })
  getPlatformStats() {
    return this.admin.getPlatformStats();
  }

  // ── Config ───────────────────────────────────────────────────────────────────

  @Get('config')
  @ApiOperation({ summary: 'List all platform config (secrets masked)' })
  listConfig() { return this.admin.listConfig(); }

  @Post('config')
  @ApiOperation({ summary: 'Create a platform config entry' })
  createConfig(@Body() dto: CreateConfigDto) { return this.admin.createConfig(dto); }

  @Put('config/:key')
  @ApiOperation({ summary: 'Update a platform config value' })
  updateConfig(@Param('key') key: string, @Body() body: UpdateConfigBodyDto) {
    return this.admin.updateConfig(key, body.value);
  }

  @Delete('config/:key')
  @ApiOperation({ summary: 'Delete a platform config entry' })
  deleteConfig(@Param('key') key: string) { return this.admin.deleteConfig(key); }

  // ── Users ────────────────────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'List all users' })
  listUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: AccountStatus,
  ) {
    return this.admin.listUsers(Number(page ?? 1), Number(limit ?? 50), status);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update user role, platformRole or status' })
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.admin.updateUser(id, dto);
  }

  @Post('platform-admin-invites')
  @ApiOperation({ summary: 'Invite or promote a platform admin by email' })
  invitePlatformAdmin(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: InvitePlatformAdminDto,
  ) {
    return this.admin.invitePlatformAdmin(admin.sub, dto.email, dto.name);
  }

  @Post('users/:id/suspend')
  @ApiOperation({ summary: 'Suspend a user account' })
  suspendUser(@Param('id') id: string) {
    return this.admin.suspendUser(id);
  }

  @Post('users/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a suspended/deactivated user' })
  reactivateUser(@Param('id') id: string) {
    return this.admin.reactivateUser(id);
  }

  // ── Registration Approvals ───────────────────────────────────────────────────

  @Get('approvals')
  @ApiOperation({ summary: 'List users pending registration approval' })
  listPendingApprovals() {
    return this.admin.listPendingApprovals();
  }

  @Post('approvals/:userId/approve')
  @ApiOperation({ summary: 'Approve a registration' })
  approveUser(
    @Param('userId') userId: string,
    @CurrentUser() admin: JwtPayload,
    @Body() dto: ApprovalActionDto,
  ) {
    return this.admin.approveUser(userId, admin.sub, dto.note);
  }

  @Post('approvals/:userId/reject')
  @ApiOperation({ summary: 'Reject a registration' })
  rejectUser(
    @Param('userId') userId: string,
    @CurrentUser() admin: JwtPayload,
    @Body() dto: ApprovalActionDto,
  ) {
    return this.admin.rejectUser(userId, admin.sub, dto.note);
  }

  // ── Organisations ────────────────────────────────────────────────────────────

  @Get('orgs')
  @ApiOperation({ summary: 'List all organisations' })
  listOrgs(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.admin.listOrgs(Number(page ?? 1), Number(limit ?? 50));
  }

  @Get('orgs/:orgId')
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: 'Get org detail with stats for platform admin' })
  getOrgDetail(@Param('orgId') orgId: string) {
    return this.admin.getOrgDetail(orgId);
  }

  @Patch('orgs/:orgId/status')
  @ApiOperation({ summary: 'Update org active status (suspend / activate)' })
  updateOrgStatus(@Param('orgId') orgId: string, @Body() dto: UpdateOrgStatusDto) {
    return this.admin.updateOrgStatus(orgId, dto.isActive);
  }

  @Delete('orgs/:orgId')
  @ApiOperation({ summary: 'Delete (soft-delete) an organisation' })
  deleteOrg(@Param('orgId') orgId: string) {
    return this.admin.deleteOrg(orgId);
  }

  // ── Audit Logs ───────────────────────────────────────────────────────────────

  @Get('audit-logs')
  @ApiOperation({ summary: 'View paginated audit log' })
  getAuditLogs(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.audit.findAll(Number(page ?? 1), Number(limit ?? 50));
  }
}
