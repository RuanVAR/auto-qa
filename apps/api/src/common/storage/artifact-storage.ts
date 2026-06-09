import { createStorageProvider, StorageProvider } from '@qa-platform/storage';
import { artifactStoragePath } from '../config/app';

/**
 * The artifact-scoped StorageProvider — run artifacts, report PDFs and sign-off
 * certificates. Same STORAGE_PROVIDER switch as user uploads, but the local
 * backend roots at ARTIFACT_STORAGE_PATH (./artifacts) so existing on-disk run
 * artifacts keep resolving (uploads use UPLOAD_STORAGE_PATH).
 *
 * Single source for the config that was duplicated across ArtifactsModule,
 * reports.service and signoff.service. Note this is a plain factory rather than
 * a DI-injected singleton on purpose: ARTIFACT_STORAGE is module-scoped, and
 * exporting it globally would mean more @Global modules (which we're trying to
 * reduce) for no real gain — these providers are cheap, stateless backends.
 */
export function createArtifactStorage(env: NodeJS.ProcessEnv = process.env): StorageProvider {
  return createStorageProvider(env, {
    localBasePath: artifactStoragePath(env),
  });
}
