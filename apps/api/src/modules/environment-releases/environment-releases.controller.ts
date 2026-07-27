import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EnvAccessService } from '../../common/access/env-access.service';
import { accessCtx } from '../../common/access/access-context';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateDeployTokenDto } from './dto/create-deploy-token.dto';
import { CreateDeploymentDto } from './dto/create-deployment.dto';
import { DeployTokenGuard } from './deploy-token.guard';
import { DeployTokensService } from './deploy-tokens.service';
import { EnvironmentReleasesService } from './environment-releases.service';
import { EnvironmentReleaseSource } from '@prisma/client';

interface RequestMetadata {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  deployTokenId?: string;
}

@ApiTags('environment-releases')
@ApiBearerAuth()
@Controller()
export class EnvironmentReleasesController {
  constructor(
    private readonly releases: EnvironmentReleasesService,
    private readonly tokens: DeployTokensService,
    private readonly access: EnvAccessService,
  ) {}

  @Get('projects/:projectId/environments/:environmentId/releases')
  @ApiOperation({ summary: 'List immutable deployment history for an environment' })
  async list(
    @Param('projectId') projectId: string,
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: string,
  ) {
    await this.access.assertEnvAccess(user.sub, projectId, environmentId, accessCtx(user));
    return this.releases.list(projectId, environmentId, Number(limit) || 30);
  }

  @Get('projects/:projectId/environments/:environmentId/releases/current')
  @ApiOperation({ summary: 'Get the current successful environment release' })
  async current(
    @Param('projectId') projectId: string,
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.access.assertEnvAccess(user.sub, projectId, environmentId, accessCtx(user));
    return this.releases.current(projectId, environmentId);
  }

  @Post('projects/:projectId/environments/:environmentId/releases/infer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Infer a release from bound repository manifests at exact branch heads' })
  async infer(
    @Param('projectId') projectId: string,
    @Param('environmentId') environmentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.access.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    return this.releases.inferFromRepository(projectId, environmentId);
  }

  @Post('projects/:projectId/environments/:environmentId/deployments')
  @Public()
  @UseGuards(DeployTokenGuard)
  @HttpCode(201)
  @ApiOperation({ summary: 'Publish a deployment from any CI/CD system using a scoped project token' })
  recordDeployment(
    @Param('projectId') projectId: string,
    @Param('environmentId') environmentId: string,
    @Body() dto: CreateDeploymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.releases.recordDeployment(
      projectId,
      environmentId,
      dto,
      EnvironmentReleaseSource.CI_API,
      idempotencyKey,
    );
  }

  @Get('projects/:projectId/deploy-tokens')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List project deployment tokens without exposing their secrets' })
  async listTokens(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.access.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    return this.tokens.list(projectId);
  }

  @Post('projects/:projectId/deploy-tokens')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Issue a scoped deployment token; plaintext is returned once' })
  async issueToken(
    @Param('projectId') projectId: string,
    @Body() dto: CreateDeployTokenDto,
    @CurrentUser() user: JwtPayload,
    @Req() request: RequestMetadata,
  ) {
    await this.access.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    return this.tokens.issue(projectId, dto, user.sub, requestContext(user, request));
  }

  @Delete('projects/:projectId/deploy-tokens/:tokenId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a project deployment token' })
  async revokeToken(
    @Param('projectId') projectId: string,
    @Param('tokenId') tokenId: string,
    @CurrentUser() user: JwtPayload,
    @Req() request: RequestMetadata,
  ) {
    await this.access.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    await this.tokens.revoke(projectId, tokenId, user.sub, requestContext(user, request));
  }

  @Post('projects/:projectId/repos/:repoId/deployment-webhook/rotate')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Rotate the GitHub deployment webhook secret and return it once' })
  async rotateGithubWebhook(
    @Param('projectId') projectId: string,
    @Param('repoId') repoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.access.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    return this.releases.rotateGithubWebhook(projectId, repoId);
  }
}

function requestContext(user: JwtPayload, request: RequestMetadata) {
  const forwarded = first(request.headers['x-forwarded-for']);
  return {
    orgId: user.activeOrgId ?? null,
    ip: forwarded?.split(',')[0]?.trim() ?? request.ip ?? null,
    userAgent: first(request.headers['user-agent']) ?? null,
  };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
