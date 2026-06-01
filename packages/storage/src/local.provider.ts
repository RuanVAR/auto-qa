import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { StorageProvider } from './storage.provider';

/**
 * Local-disk storage. Keys are resolved relative to `basePath`. This is
 * the default backend and the guaranteed fallback when no cloud provider
 * is configured. Behaviour matches the original NestJS LocalStorageProvider
 * that previously lived in apps/api — just decoupled from Nest DI so the
 * worker can use it too.
 */
export class LocalStorageProvider extends StorageProvider {
  private readonly basePath: string;

  constructor(basePath = './uploads') {
    super();
    this.basePath = basePath;
    fs.mkdirSync(this.basePath, { recursive: true });
  }

  private full(key: string): string {
    return path.join(this.basePath, key);
  }

  async upload(key: string, buffer: Buffer, _mimeType: string): Promise<void> {
    const full = this.full(key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, buffer);
  }

  async uploadFile(key: string, localPath: string, _mimeType: string): Promise<void> {
    const full = this.full(key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    // copyFile (not rename) so the caller still owns the temp file and can
    // unlink it deterministically — rename across devices/mounts can fail.
    await fs.promises.copyFile(localPath, full);
  }

  async stream(key: string): Promise<Readable> {
    return fs.createReadStream(this.full(key));
  }

  async streamRange(key: string, start: number, end: number): Promise<Readable> {
    return fs.createReadStream(this.full(key), { start, end });
  }

  async getSize(key: string): Promise<number> {
    const st = await fs.promises.stat(this.full(key));
    return st.size;
  }

  async delete(key: string): Promise<void> {
    const full = this.full(key);
    if (fs.existsSync(full)) await fs.promises.unlink(full);
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.full(key));
  }
}
