import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createStorageProvider } from '@qa-platform/storage';
import { ArtifactsController, ArtifactsDirectController } from './artifacts.controller';
import { ArtifactsService, ARTIFACT_STORAGE } from './artifacts.service';

@Module({
  controllers: [ArtifactsController, ArtifactsDirectController],
  providers: [
    ArtifactsService,
    {
      // Artifact-scoped provider — same STORAGE_PROVIDER switch as uploads,
      // but the local backend roots at ARTIFACT_STORAGE_PATH so existing
      // on-disk run artifacts keep resolving.
      provide: ARTIFACT_STORAGE,
      useFactory: (config: ConfigService) =>
        createStorageProvider(process.env, {
          localBasePath: config.get<string>('ARTIFACT_STORAGE_PATH', './artifacts'),
        }),
      inject: [ConfigService],
    },
  ],
  exports: [ArtifactsService],
})
export class ArtifactsModule {}
