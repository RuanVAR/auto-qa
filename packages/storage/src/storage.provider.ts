import { Readable } from 'stream';

/**
 * Backend-agnostic media storage contract. Implemented by the local-disk
 * provider and each cloud provider (S3 / GCS / Azure). Keys are
 * relative, slash-delimited paths (e.g. `runs/<runId>/<file>` or
 * `<orgId>/<uuid>.png`) — the local provider joins them onto a base
 * directory, cloud providers use them verbatim as object keys.
 */
export abstract class StorageProvider {
  /** Upload an in-memory buffer (used for multipart uploads). */
  abstract upload(key: string, buffer: Buffer, mimeType: string): Promise<void>;

  /**
   * Upload directly from a local file path, streamed — avoids buffering
   * large run recordings into memory. Used by the worker's
   * capture-then-upload flow.
   */
  abstract uploadFile(key: string, localPath: string, mimeType: string): Promise<void>;

  abstract stream(key: string): Promise<Readable>;

  /** Inclusive byte range [start, end] — used for HTTP Range / video seeking. */
  abstract streamRange(key: string, start: number, end: number): Promise<Readable>;

  abstract getSize(key: string): Promise<number>;

  abstract delete(key: string): Promise<void>;

  abstract exists(key: string): Promise<boolean>;
}
