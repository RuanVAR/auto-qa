import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageProvider } from './storage.provider';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

@Injectable()
export class LocalStorageProvider extends StorageProvider {
  private readonly basePath: string;
  constructor(config: ConfigService) {
    super();
    this.basePath = config.get<string>('UPLOAD_STORAGE_PATH', './uploads');
    fs.mkdirSync(this.basePath, { recursive: true });
  }
  async upload(key: string, buffer: Buffer, _mimeType: string): Promise<void> {
    const full = path.join(this.basePath, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, buffer);
  }
  async stream(key: string): Promise<Readable> {
    return fs.createReadStream(path.join(this.basePath, key));
  }
  async streamRange(key: string, start: number, end: number): Promise<Readable> {
    const full = path.join(this.basePath, key);
    return fs.createReadStream(full, { start, end });
  }
  async getSize(key: string): Promise<number> {
    const full = path.join(this.basePath, key);
    const st = await fs.promises.stat(full);
    return st.size;
  }
  async delete(key: string): Promise<void> {
    const full = path.join(this.basePath, key);
    if (fs.existsSync(full)) await fs.promises.unlink(full);
  }
  async exists(key: string): Promise<boolean> {
    return fs.existsSync(path.join(this.basePath, key));
  }
}
