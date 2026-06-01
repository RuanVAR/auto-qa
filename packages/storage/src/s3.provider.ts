import * as fs from 'fs';
import { Readable } from 'stream';
import { StorageProvider } from './storage.provider';

export interface S3Config {
  bucket: string;
  region: string;
  /** Optional custom endpoint for S3-compatible stores (MinIO, R2, Spaces, B2). */
  endpoint?: string;
  /** Path-style addressing — required by most S3-compatible stores. */
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * AWS S3 (and S3-compatible) provider. The SDK is imported lazily so a
 * local-only deployment never loads it. Works against MinIO / Cloudflare
 * R2 / DigitalOcean Spaces / Backblaze B2 via `endpoint` + `forcePathStyle`.
 */
export class S3StorageProvider extends StorageProvider {
  private clientPromise?: Promise<any>;

  constructor(private readonly cfg: S3Config) {
    super();
  }

  private async client(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { S3Client } = await import('@aws-sdk/client-s3');
        return new S3Client({
          region: this.cfg.region,
          ...(this.cfg.endpoint ? { endpoint: this.cfg.endpoint } : {}),
          ...(this.cfg.forcePathStyle ? { forcePathStyle: true } : {}),
          ...(this.cfg.accessKeyId && this.cfg.secretAccessKey
            ? {
                credentials: {
                  accessKeyId: this.cfg.accessKeyId,
                  secretAccessKey: this.cfg.secretAccessKey,
                },
              }
            : {}),
        });
      })();
    }
    return this.clientPromise;
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    const [{ PutObjectCommand }, client] = await Promise.all([
      import('@aws-sdk/client-s3'),
      this.client(),
    ]);
    await client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
  }

  async uploadFile(key: string, localPath: string, mimeType: string): Promise<void> {
    // lib-storage's Upload handles multipart streaming for large files.
    const [{ Upload }, client] = await Promise.all([
      import('@aws-sdk/lib-storage'),
      this.client(),
    ]);
    const upload = new Upload({
      client,
      params: {
        Bucket: this.cfg.bucket,
        Key: key,
        Body: fs.createReadStream(localPath),
        ContentType: mimeType,
      },
    });
    await upload.done();
  }

  async stream(key: string): Promise<Readable> {
    const [{ GetObjectCommand }, client] = await Promise.all([
      import('@aws-sdk/client-s3'),
      this.client(),
    ]);
    const res = await client.send(
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
    );
    return res.Body as Readable;
  }

  async streamRange(key: string, start: number, end: number): Promise<Readable> {
    const [{ GetObjectCommand }, client] = await Promise.all([
      import('@aws-sdk/client-s3'),
      this.client(),
    ]);
    const res = await client.send(
      new GetObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Range: `bytes=${start}-${end}`,
      }),
    );
    return res.Body as Readable;
  }

  async getSize(key: string): Promise<number> {
    const [{ HeadObjectCommand }, client] = await Promise.all([
      import('@aws-sdk/client-s3'),
      this.client(),
    ]);
    const res = await client.send(
      new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
    );
    return res.ContentLength ?? 0;
  }

  async delete(key: string): Promise<void> {
    const [{ DeleteObjectCommand }, client] = await Promise.all([
      import('@aws-sdk/client-s3'),
      this.client(),
    ]);
    await client.send(
      new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
    );
  }

  async exists(key: string): Promise<boolean> {
    const [{ HeadObjectCommand }, client] = await Promise.all([
      import('@aws-sdk/client-s3'),
      this.client(),
    ]);
    try {
      await client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return true;
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') {
        return false;
      }
      throw err;
    }
  }
}
