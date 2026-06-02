import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OrganisationsService } from './organisations.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRoleGuard, OrgRoles } from '../../common/guards/org-role.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { OrgRole } from '@prisma/client';

@ApiTags('organisations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRoleGuard)
@Controller('orgs')
export class OrganisationsController {
  constructor(private readonly service: OrganisationsService) {}

  @Get(':orgId')
  @ApiOperation({ summary: 'Get organisation details' })
  getOrg(@Param('orgId') orgId: string) {
    return this.service.getOrg(orgId);
  }

  @Patch(':orgId')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Update organisation details' })
  updateOrg(@Param('orgId') orgId: string, @Body() body: Partial<{ name: string; description: string; website: string; logoUrl: string; primaryColor: string | null }>) {
    // Validate the brand colour is a hex (#rrggbb) or cleared (null/empty → reset to default).
    if (body.primaryColor != null && body.primaryColor !== '' && !/^#[0-9a-fA-F]{6}$/.test(body.primaryColor)) {
      throw new BadRequestException('primaryColor must be a hex colour like #7c3aed');
    }
    return this.service.updateOrg(orgId, body);
  }

  @Get(':orgId/members')
  @ApiOperation({ summary: 'List org members' })
  getMembers(@Param('orgId') orgId: string) {
    return this.service.getMembers(orgId);
  }

  @Post(':orgId/invites')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Invite a user to the organisation' })
  inviteMember(
    @Param('orgId') orgId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: InviteMemberDto,
  ) {
    return this.service.inviteMember(orgId, user.sub, dto);
  }

  @Get(':orgId/invites')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'List pending invites' })
  listInvites(@Param('orgId') orgId: string) {
    return this.service.listInvites(orgId);
  }

  @Delete(':orgId/invites/:inviteId')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Cancel a pending invite' })
  cancelInvite(@Param('orgId') orgId: string, @Param('inviteId') inviteId: string) {
    return this.service.cancelInvite(inviteId, orgId);
  }

  @Get('invites/:token/preview')
  @Public()
  @ApiOperation({ summary: 'Preview an invite token — returns email, org name and whether the user already has an account. No auth required.' })
  previewInvite(@Param('token') token: string) {
    return this.service.getInvitePreview(token);
  }

  @Get('by-slug/:slug/branding')
  @Public()
  @ApiOperation({ summary: 'Public org branding (name + logo) by slug — for pre-login per-org branded login pages. No auth; returns cosmetic fields only.' })
  publicBranding(@Param('slug') slug: string) {
    return this.service.getPublicBranding(slug);
  }

  @Post('invites/:token/accept')
  @ApiOperation({ summary: 'Accept an org invite' })
  acceptInvite(@Param('token') token: string, @CurrentUser() user: JwtPayload) {
    return this.service.acceptInvite(token, user.sub);
  }

  @Delete(':orgId/members/:userId')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Remove a member from the organisation' })
  removeMember(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @CurrentUser() requester: JwtPayload,
  ) {
    return this.service.removeMember(orgId, userId, requester.sub);
  }

  @Patch(':orgId/members/:userId/role')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Update a member role' })
  updateRole(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: { role: OrgRole },
    @CurrentUser() requester: JwtPayload,
  ) {
    return this.service.updateMemberRole(orgId, userId, body.role, requester.sub);
  }
}
