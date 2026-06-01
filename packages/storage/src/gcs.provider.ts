import { Readable } from 'stream';
import { StorageProvider } from './storage.provider';

export interface GcsConfig {
  bucket: string;
  projectId?: string;
  /** Path to a service-account JSON key file (GOOGLE_APPLICATION_CREDENTIALS). */
  keyFilename?: string;
}

/**
 * Google Cloud Storage provider. SDK imported lazily. Credentials resolve
 * from `keyFilename` if given, otherwise from Application Default
 * Credentials (GOOGLE_APPLICATION_CREDENTIALS / workload identity).
 */
export class GcsStorageProvider extends StorageProvider {
  private bucketPromise?: Promise<any>;

  constructor(private readonly cfg: GcsConfig) {
    super();
  }

  private async bucket(): Promise<any> {
    if (!this.bucketPromise) {
      this.bucketPromise = (async () => {
        const { Storage } = await import('@google-cloud/storage');
        const storage = new Storage({
          ...(this.cfg.projectId ? { projectId: this.cfg.projectId } : {}),
          ...(this.cfg.keyFilename ? { keyFilename: this.cfg.keyFilename } : {}),
        });
        return storage.bucket(this.cfg.bucket);
      })();
    }
    return this.bucketPromise;
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    const bucket = await this.bucket();
    await bucket.file(key).save(buffer, { contentType: mimeType, resumable: false });
  }

  async uploadFile(key: string, localPath: string, mimeType: string): Promise<void> {
    const bucket = await this.bucket();
    await bucket.upload(localPath, {
      destination: key,
      metadata: { contentType: mimeType },
    });
  }

  async stream(key: string): Promise<Readable> {
    const bucket = await this.bucket();
    return bucket.file(key).createReadStream();
  }

  async streamRange(key: string, start: number, end: number): Promise<Readable> {
    const bucket = await this.bucket();
    return bucket.file(key).createReadStream({ start, end });
  }

  async getSize(key: string): Promise<number> {
    const bucket = await this.bucket();
    const [meta] = await bucket.file(key).getMetadata();
    return Number(meta.size ?? 0);
  }

  async delete(key: string): Promise<void> {
    const bucket = await this.bucket();
    await bucket.file(key).delete({ ignoreNotFound: true });
  }

  async exists(key: string): Promise<boolean> {
    const bucket = await this.bucket();
    const [exists] = await bucket.file(key).exists();
    return exists;
  }
}
