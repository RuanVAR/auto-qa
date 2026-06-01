import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageProvider, createStorageProvider } from '@qa-platform/storage';

/**
 * Provides the global `StorageProvider` for user uploads. The backend is
 * chosen by `STORAGE_PROVIDER` (local | s3 | gcs | azure) and falls back to
 * local disk when unset or misconfigured — see the factory in
 * @qa-platform/storage. Uploads use UPLOAD_STORAGE_PATH for the local
 * backend; run artifacts get their own provider (ARTIFACT_STORAGE_PATH)
 * inside ArtifactsModule.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: StorageProvider,
      useFactory: (config: ConfigService) =>
        createStorageProvider(process.env, {
          localBasePath: config.get<string>('UPLOAD_STORAGE_PATH', './uploads'),
        }),
      inject: [ConfigService],
    },
  ],
  exports: [StorageProvider],
})
export class StorageModule {}
