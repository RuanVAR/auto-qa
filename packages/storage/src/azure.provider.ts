import { Readable } from 'stream';
import { StorageProvider } from './storage.provider';

export interface AzureConfig {
  container: string;
  /** Full connection string (preferred), or account name + key below. */
  connectionString?: string;
  accountName?: string;
  accountKey?: string;
}

/**
 * Azure Blob Storage provider. SDK imported lazily. Authenticates via a
 * connection string, or an account-name + account-key pair.
 */
export class AzureBlobStorageProvider extends StorageProvider {
  private containerPromise?: Promise<any>;

  constructor(private readonly cfg: AzureConfig) {
    super();
  }

  private async container(): Promise<any> {
    if (!this.containerPromise) {
      this.containerPromise = (async () => {
        const { BlobServiceClient, StorageSharedKeyCredential } = await import(
          '@azure/storage-blob'
        );
        let service: any;
        if (this.cfg.connectionString) {
          service = BlobServiceClient.fromConnectionString(this.cfg.connectionString);
        } else if (this.cfg.accountName && this.cfg.accountKey) {
          const cred = new StorageSharedKeyCredential(
            this.cfg.accountName,
            this.cfg.accountKey,
          );
          service = new BlobServiceClient(
            `https://${this.cfg.accountName}.blob.core.windows.net`,
            cred,
          );
        } else {
          throw new Error(
            'Azure storage requires AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT + AZURE_STORAGE_KEY',
          );
        }
        return service.getContainerClient(this.cfg.container);
      })();
    }
    return this.containerPromise;
  }

  private async block(key: string): Promise<any> {
    const container = await this.container();
    return container.getBlockBlobClient(key);
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    const blob = await this.block(key);
    await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mimeType } });
  }

  async uploadFile(key: string, localPath: string, mimeType: string): Promise<void> {
    const blob = await this.block(key);
    await blob.uploadFile(localPath, {
      blobHTTPHeaders: { blobContentType: mimeType },
    });
  }

  async stream(key: string): Promise<Readable> {
    const blob = await this.block(key);
    const res = await blob.download();
    return res.readableStreamBody as Readable;
  }

  async streamRange(key: string, start: number, end: number): Promise<Readable> {
    const blob = await this.block(key);
    // Azure's download offset/count is exclusive of end → count = end - start + 1.
    const res = await blob.download(start, end - start + 1);
    return res.readableStreamBody as Readable;
  }

  async getSize(key: string): Promise<number> {
    const blob = await this.block(key);
    const props = await blob.getProperties();
    return props.contentLength ?? 0;
  }

  async delete(key: string): Promise<void> {
    const blob = await this.block(key);
    await blob.deleteIfExists();
  }

  async exists(key: string): Promise<boolean> {
    const blob = await this.block(key);
    return blob.exists();
  }
}
