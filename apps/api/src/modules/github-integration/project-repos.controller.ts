import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EnvAccessService } from '../../common/access/env-access.service';
import { accessCtx } from '../../common/access/access-context';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LinkRepoDto } from './dto/link-repo.dto';
import { UpdateRepoDto } from './dto/update-repo.dto';
import { PutRepoEnvBindingsDto } from './dto/put-repo-env-bindings.dto';
import { ProjectReposService } from './project-repos.service';

/**
 * Project <-> repo links (N repos -> 1 project). Reads require project
 * membership; writes require elevated project access.
 */
@ApiTags('project-repos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ProjectReposController {
  constructor(
    private readonly service: ProjectReposService,
    private readonly envAccess: EnvAccessService,
  ) {}

  @Get('projects/:projectId/repos')
  @ApiOperation({ summary: 'List repos linked to a project (with index status)' })
  async list(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, accessCtx(user));
    return this.service.list(projectId);
  }

  @Get('projects/:projectId/repos/available')
  @ApiOperation({ summary: 'List repositories accessible through the org GitHub credential' })
  async available(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    await this.envAccess.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    return this.service.listAvailable(projectId);
  }

  @Post('projects/:projectId/repos')
  @ApiOperation({ summary: 'Link a repo to the project (verifies reachability)' })
  async link(
    @Param('projectId') projectId: string,
    @Body() dto: LinkRepoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.envAccess.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    return this.service.link(projectId, dto, user.sub);
  }

  @Patch('projects/:projectId/repos/:repoId')
  @ApiOperation({ summary: 'Update a linked repo (role / branch / globs)' })
  async update(
    @Param('projectId') projectId: string,
    @Param('repoId') repoId: string,
    @Body() dto: UpdateRepoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.envAccess.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    return this.service.update(projectId, repoId, dto, user.sub);
  }

  @Delete('projects/:projectId/repos/:repoId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unlink a repo from the project' })
  async unlink(
    @Param('projectId') projectId: string,
    @Param('repoId') repoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.envAccess.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    await this.service.unlink(projectId, repoId);
  }

  @Post('projects/:projectId/repos/:repoId/reindex')
  @ApiOperation({ summary: 'Force a new index generation for the default branch' })
  async reindex(
    @Param('projectId') projectId: string,
    @Param('repoId') repoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.envAccess.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    return this.service.reindexDefaultBranch(projectId, repoId, user.sub);
  }

  @Get('projects/:projectId/repos/:repoId/branches')
  @ApiOperation({ summary: 'List branches available from the repository provider' })
  async branches(
    @Param('projectId') projectId: string,
    @Param('repoId') repoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, accessCtx(user));
    return this.service.listBranches(projectId, repoId);
  }

  @Put('projects/:projectId/repos/:repoId/env-bindings')
  @ApiOperation({ summary: 'Replace environment-to-branch bindings for a repository' })
  async putEnvBindings(
    @Param('projectId') projectId: string,
    @Param('repoId') repoId: string,
    @Body() dto: PutRepoEnvBindingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.envAccess.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    return this.service.replaceEnvBindings(projectId, repoId, dto.bindings, user.sub);
  }

  @Get('projects/:projectId/repos/:repoId/env-bindings')
  @ApiOperation({ summary: 'List active environment-to-branch bindings for a repository' })
  async envBindings(
    @Param('projectId') projectId: string,
    @Param('repoId') repoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, accessCtx(user));
    return this.service.listEnvBindings(projectId, repoId);
  }

  @Get('projects/:projectId/repos/:repoId/indexes')
  @ApiOperation({ summary: 'List branch index status for a repository' })
  async indexes(
    @Param('projectId') projectId: string,
    @Param('repoId') repoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, accessCtx(user));
    return this.service.listIndexes(projectId, repoId);
  }

  @Post('projects/:projectId/repos/:repoId/indexes/:indexId/reindex')
  @ApiOperation({ summary: 'Force a new generation for one repository branch index' })
  async reindexBranch(
    @Param('projectId') projectId: string,
    @Param('repoId') repoId: string,
    @Param('indexId') indexId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.envAccess.assertElevatedProjectAccess(user.sub, projectId, accessCtx(user));
    return this.service.reindexBranch(projectId, repoId, indexId, user.sub);
  }

  @Get('projects/:projectId/repos/index-summary')
  @ApiOperation({ summary: 'Summarise repository and branch index state for a project' })
  async indexSummary(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, accessCtx(user));
    return this.service.indexSummary(projectId);
  }
}
