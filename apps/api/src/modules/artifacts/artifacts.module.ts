import { Module } from '@nestjs/common';
import { createArtifactStorage } from '../../common/storage/artifact-storage';
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
      useFactory: () => createArtifactStorage(),
    },
  ],
  exports: [ArtifactsService],
})
export class ArtifactsModule {}
