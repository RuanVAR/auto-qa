import { Readable } from 'stream';

export abstract class StorageProvider {
  abstract upload(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  abstract stream(key: string): Promise<Readable>;
  /** Inclusive byte range [start, end] — used for HTTP Range / video seeking. */
  abstract streamRange(key: string, start: number, end: number): Promise<Readable>;
  abstract getSize(key: string): Promise<number>;
  abstract delete(key: string): Promise<void>;
  abstract exists(key: string): Promise<boolean>;
}
