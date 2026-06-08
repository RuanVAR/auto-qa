import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { SmokeAwareThrottlerGuard } from './common/guards/smoke-aware-throttler.guard';
import { PrismaModule } from './common/prisma/prisma.module';
import { SecretsModule } from './common/secrets/secrets.module';
import { AccessModule } from './common/access/access.module';
import { EmailModule } from './email/email.module';
import { QueueModule } from './modules/queue/queue.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { EnvironmentsModule } from './modules/environments/environments.module';
import { TestsModule } from './modules/tests/tests.module';
import { RunsModule } from './modules/runs/runs.module';
import { ArtifactsModule } from './modules/artifacts/artifacts.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ModulesModule } from './modules/modules/modules.module';
import { FeaturesModule } from './modules/features/features.module';
import { FeatureVersionsModule } from './modules/feature-versions/feature-versions.module';
import { FeatureRunsModule } from './modules/feature-runs/feature-runs.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { WebsocketModule } from './modules/websocket/websocket.module';
import { OrganisationsModule } from './modules/organisations/organisations.module';
import { AccessRequestsModule } from './modules/access-requests/access-requests.module';
import { StatsModule } from './modules/stats/stats.module';
import { PhasesModule } from './modules/phases/phases.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SignoffModule } from './modules/signoff/signoff.module';
import { ReportSchedulesModule } from './modules/report-schedules/report-schedules.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ImportExportModule } from './modules/import-export/import-export.module';
import { IssuesModule } from './modules/issues/issues.module';
import { NotesModule } from './modules/notes/notes.module';
import { AcLinksModule } from './modules/ac-links/ac-links.module';
import { RecorderModule } from './modules/recorder/recorder.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { GithubIntegrationModule } from './modules/github-integration/github-integration.module';
import { StorageModule } from './common/storage/storage.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { WorkSessionsModule } from './modules/work-sessions/work-sessions.module';
import { PlatformBrandingModule } from './modules/platform/platform-branding.module';
import { ClickUpLinksModule } from './modules/clickup-links/clickup-links.module';
import { PluginsModule } from './plugins/plugins.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // 4.1 — Global rate limiting: 100 req/min default; auth endpoints get a tighter limit via @Throttle()
    // Global limit was 100/min — too tight for active testing pages where
    // socket-driven invalidations cause legitimate bursts of polling.
    // 300/min still defends against abuse but lets a typical run breathe.
    ThrottlerModule.forRoot([
      // Dev-friendly bump: typeahead search modals (doc-link, ticket-link)
      // refire on every keystroke and each call fans out across N installs,
      // so 300/min got chewed through fast during interactive use. 1500/min
      // still catches abuse but keeps active dev usage unblocked.
      { name: 'global', ttl: 60_000, limit: 1500 },
      {
        name: 'auth',
        ttl: 60_000,
        limit: 10,
        // The auth throttler is brute-force protection for the login / 2FA /
        // password routes ONLY. A named throttler otherwise applies to EVERY
        // endpoint (each with its own 10/min budget), which silently caps busy
        // read endpoints — a feature page loads the issues list + stats several
        // times and 429s once it crosses 10/min (the bug that kept resurfacing,
        // patched per-endpoint with @SkipThrottle). Scope it to /auth/* so every
        // other route is governed solely by the 1500/min global throttler.
        skipIf: (ctx) => {
          const req = ctx.switchToHttp().getRequest<{ originalUrl?: string; url?: string }>();
          const path = req?.originalUrl ?? req?.url ?? '';
          return !path.includes('/auth/');
        },
      },
    ]),
    PrismaModule,
    SecretsModule,
    AccessModule,
    EmailModule,
    QueueModule,
    AuthModule,
    ProjectsModule,
    EnvironmentsModule,
    TestsModule,
    RunsModule,
    ArtifactsModule,
    AiModule,
    HealthModule,
    ModulesModule,
    FeaturesModule,
    FeatureVersionsModule,
    FeatureRunsModule,
    AdminModule,
    AuditModule,
    WebsocketModule,
    OrganisationsModule,
    AccessRequestsModule,
    StatsModule,
    PhasesModule,
    ReportsModule,
    ReportSchedulesModule,
    SignoffModule,
    ImportExportModule,
    IssuesModule,
    NotificationsModule,
    StorageModule,
    UploadsModule,
    PlatformBrandingModule,
    WorkSessionsModule,
    PluginsModule,
    ClickUpLinksModule,
    NotesModule,
    AcLinksModule,
    RecorderModule,
    AnalyticsModule,
    GithubIntegrationModule,
  ],
  providers: [
    // Throttler must be first so it runs before auth/role guards
    { provide: APP_GUARD, useClass: SmokeAwareThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
