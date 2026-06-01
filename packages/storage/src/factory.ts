import { StorageProvider } from './storage.provider';
import { LocalStorageProvider } from './local.provider';
import { S3StorageProvider } from './s3.provider';
import { GcsStorageProvider } from './gcs.provider';
import { AzureBlobStorageProvider } from './azure.provider';

export type EnvMap = Record<string, string | undefined>;

export interface FactoryOptions {
  /**
   * Base directory for the LOCAL provider. Uploads and artifacts use
   * different directories (`./uploads` vs `./.artifacts`), so the caller
   * passes the right one. Ignored by cloud providers.
   */
  localBasePath?: string;
}

/**
 * Builds the configured StorageProvider from env. `STORAGE_PROVIDER`
 * selects the backend (`local | s3 | gcs | azure`). Anything unknown,
 * unset, or missing its required config logs a warning and falls back to
 * the local-disk provider — local is always a safe default.
 */
export function createStorageProvider(
  env: EnvMap = process.env,
  opts: FactoryOptions = {},
): StorageProvider {
  const localBasePath = opts.localBasePath ?? env.UPLOAD_STORAGE_PATH ?? './uploads';
  const provider = (env.STORAGE_PROVIDER ?? 'local').trim().toLowerCase();

  const fallback = (reason: string): StorageProvider => {
    // eslint-disable-next-line no-console
    console.warn(
      `[storage] ${reason} — falling back to local disk at "${localBasePath}".`,
    );
    return new LocalStorageProvider(localBasePath);
  };

  switch (provider) {
    case 'local':
    case '':
      return new LocalStorageProvider(localBasePath);

    case 's3': {
      const bucket = env.S3_BUCKET;
      const region = env.S3_REGION;
      if (!bucket || !region) {
        return fallback('STORAGE_PROVIDER=s3 but S3_BUCKET / S3_REGION not set');
      }
      return new S3StorageProvider({
        bucket,
        region,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      });
    }

    case 'gcs':
    case 'gcp': {
      const bucket = env.GCS_BUCKET;
      if (!bucket) {
        return fallback('STORAGE_PROVIDER=gcs but GCS_BUCKET not set');
      }
      return new GcsStorageProvider({
        bucket,
        projectId: env.GCS_PROJECT_ID,
        keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS,
      });
    }

    case 'azure': {
      const container = env.AZURE_CONTAINER;
      const hasAuth =
        env.AZURE_STORAGE_CONNECTION_STRING ||
        (env.AZURE_STORAGE_ACCOUNT && env.AZURE_STORAGE_KEY);
      if (!container || !hasAuth) {
        return fallback(
          'STORAGE_PROVIDER=azure but AZURE_CONTAINER / credentials not set',
        );
      }
      return new AzureBlobStorageProvider({
        container,
        connectionString: env.AZURE_STORAGE_CONNECTION_STRING,
        accountName: env.AZURE_STORAGE_ACCOUNT,
        accountKey: env.AZURE_STORAGE_KEY,
      });
    }

    default:
      return fallback(`Unknown STORAGE_PROVIDER="${provider}"`);
  }
}
