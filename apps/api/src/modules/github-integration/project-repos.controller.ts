import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RepoRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LinkRepoInput, ProjectReposService, UpdateRepoInput } from './project-repos.service';

/**
 * Project ↔ repo links (N repos → 1 project). Project RBAC is a future track;
 * for now we lean on JwtAuthGuard like the plugin-bindings controller. Linking
 * verifies the repo is reachable with the org's GitHub credential.
 */
@ApiTags('project-repos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ProjectReposController {
  constructor(private readonly service: ProjectReposService) {}

  @Get('projects/:projectId/repos')
  @ApiOperation({ summary: 'List repos linked to a project (with index status)' })
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post('projects/:projectId/repos')
  @ApiOperation({ summary: 'Link a repo to the project (verifies reachability)' })
  link(@Param('projectId') projectId: string, @Body() body: LinkRepoPayload) {
    return this.service.link(projectId, normalise(body));
  }

  @Patch('projects/:projectId/repos/:repoId')
  @ApiOperation({ summary: 'Update a linked repo (role / branch / globs)' })
  update(@Param('repoId') repoId: string, @Body() body: UpdateRepoInput) {
    return this.service.update(repoId, body);
  }

  @Delete('projects/:projectId/repos/:repoId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unlink a repo from the project' })
  async unlink(@Param('repoId') repoId: string) {
    await this.service.unlink(repoId);
  }

  @Post('projects/:projectId/repos/:repoId/reindex')
  @ApiOperation({ summary: 'Flag a repo for (re)indexing — Layer C indexing lands later' })
  reindex(@Param('repoId') repoId: string) {
    return this.service.reindex(repoId);
  }
}

type LinkRepoPayload = {
  repoOwner: string;
  repoName: string;
  role?: RepoRole | string;
  defaultBranch?: string;
};

function normalise(body: LinkRepoPayload): LinkRepoInput {
  return { ...body, role: body.role as RepoRole | undefined };
}
