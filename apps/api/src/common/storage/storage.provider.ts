import { Readable } from 'stream';

export abstract class StorageProvider {
  abstract upload(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  abstract stream(key: string): Promise<Readable>;
  abstract delete(key: string): Promise<void>;
  abstract exists(key: string): Promise<boolean>;
}
