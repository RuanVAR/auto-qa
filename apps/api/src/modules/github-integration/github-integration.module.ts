import { Module } from '@nestjs/common';
import { GitHubClient } from './github.client';
import { GitCredentialsService } from './git-credentials.service';
import { GitCredentialsController } from './git-credentials.controller';
import { ProjectReposService } from './project-repos.service';
import { ProjectReposController } from './project-repos.controller';

/**
 * GitHub integration — Layer A (connections).
 *
 * Org-level credential (`OrgGitCredential`) + project repos (`ProjectRepo`).
 * Separate subsystem from the plugin registry; coordinates with ClickUp via
 * TicketLink in later layers (deploy automation, codebase context). Secrets ride
 * the @Global SecretsModule, so no import needed here.
 */
@Module({
  controllers: [GitCredentialsController, ProjectReposController],
  providers: [GitHubClient, GitCredentialsService, ProjectReposService],
  exports: [GitCredentialsService, ProjectReposService],
})
export class GithubIntegrationModule {}
