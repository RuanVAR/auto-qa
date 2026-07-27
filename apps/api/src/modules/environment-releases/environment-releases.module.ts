import { Module } from '@nestjs/common';
import { AccessModule } from '../../common/access/access.module';
import { AuditModule } from '../audit/audit.module';
import { GithubIntegrationModule } from '../github-integration/github-integration.module';
import { DeployTokenGuard } from './deploy-token.guard';
import { DeployTokensService } from './deploy-tokens.service';
import { EnvironmentReleasesController } from './environment-releases.controller';
import { EnvironmentReleasesService } from './environment-releases.service';
import { GithubDeploymentsController } from './github-deployments.controller';
import { VersionResolverService } from './version-resolver.service';

@Module({
  imports: [AccessModule, AuditModule, GithubIntegrationModule],
  controllers: [EnvironmentReleasesController, GithubDeploymentsController],
  providers: [
    EnvironmentReleasesService,
    DeployTokensService,
    DeployTokenGuard,
    VersionResolverService,
  ],
  exports: [EnvironmentReleasesService],
})
export class EnvironmentReleasesModule {}
