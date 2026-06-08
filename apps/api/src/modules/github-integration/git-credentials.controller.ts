import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GitAuthKind, GitProvider } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRoleGuard, OrgRoles } from '../../common/guards/org-role.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { GitCredentialsService, UpsertGitCredentialInput } from './git-credentials.service';

/**
 * Org-level GitHub credential CRUD. Reads are open to any org member (so the app
 * can render "GitHub connected?" state); writes + test require ORG_ADMIN. The
 * secret (PAT / App private key) is never returned — GET exposes only health
 * metadata and a `hasSecret` flag.
 */
@ApiTags('github-credentials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRoleGuard)
@Controller()
export class GitCredentialsController {
  constructor(private readonly service: GitCredentialsService) {}

  @Get('orgs/:orgId/git-credential')
  @ApiOperation({ summary: 'Get the org GitHub credential (masked) — null if not configured' })
  get(@Param('orgId') orgId: string) {
    return this.service.getMasked(orgId);
  }

  @Put('orgs/:orgId/git-credential')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Create or update the org GitHub credential (re-encrypts secret)' })
  upsert(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload, @Body() body: UpsertPayload) {
    return this.service.upsert(orgId, user.sub, normalise(body));
  }

  @Delete('orgs/:orgId/git-credential')
  @OrgRoles('ORG_ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the org GitHub credential (cascades linked repos)' })
  async remove(@Param('orgId') orgId: string) {
    await this.service.remove(orgId);
  }

  @Post('orgs/:orgId/git-credential/test')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Live health probe of the stored credential; caches the result' })
  test(@Param('orgId') orgId: string) {
    return this.service.test(orgId);
  }
}

type UpsertPayload = {
  authKind: GitAuthKind | string;
  provider?: GitProvider | string;
  displayLabel?: string;
  baseUrl?: string;
  token?: string | null;
  appId?: string;
  privateKey?: string | null;
  appInstallationId?: string;
};

function normalise(body: UpsertPayload): UpsertGitCredentialInput {
  return {
    ...body,
    authKind: body.authKind as GitAuthKind,
    provider: body.provider as GitProvider | undefined,
  };
}
