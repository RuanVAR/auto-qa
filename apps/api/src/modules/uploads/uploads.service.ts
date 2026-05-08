import { Injectable, NotFoundException, GoneException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageProvider } from '../../common/storage/storage.provider';
import { ConfigService } from '@nestjs/config';
import { v4 as uuid } from 'uuid';
import * as path from 'path';

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
    private readonly config: ConfigService,
  ) {}

  async upload(
    file: Express.Multer.File,
    orgId: string,
    uploadedById: string,
    expiresInHours?: number,
  ) {
    const token = uuid();
    const ext = path.extname(file.originalname) || '';
    const storageKey = `${orgId}/${uuid()}${ext}`;
    await this.storage.upload(storageKey, file.buffer, file.mimetype);
    const expiresAt = expiresInHours
      ? new Date(Date.now() + expiresInHours * 3_600_000)
      : undefined;
    const record = await this.prisma.upload.create({
      data: {
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        token,
        orgId,
        uploadedById,
        ...(expiresAt ? { expiresAt } : {}),
      },
    });
    const apiUrl = this.config.get<string>('API_URL', 'http://localhost:3001');
    return {
      id: record.id,
      token: record.token,
      url: `${apiUrl}/api/v1/uploads/${record.token}`,
      filename: record.filename,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
    };
  }

  private async resolveUpload(token: string) {
    const upload = await this.prisma.upload.findUnique({ where: { token } });
    if (!upload) throw new NotFoundException('File not found');
    if (upload.expiresAt && upload.expiresAt < new Date())
      throw new GoneException('File link has expired');
    return upload;
  }

  /** One DB round-trip — used by GET /uploads/:token (full + Range). */
  async openDownload(token: string) {
    const upload = await this.resolveUpload(token);
    return {
      mimeType: upload.mimeType,
      filename: upload.filename,
      size: upload.sizeBytes,
      streamFull: () => this.storage.stream(upload.storageKey),
      streamRange: (start: number, end: number) =>
        this.storage.streamRange(upload.storageKey, start, end),
    };
  }

  async remove(token: string) {
    const upload = await this.prisma.upload.findUnique({ where: { token } });
    if (!upload) throw new NotFoundException('File not found');
    await this.storage.delete(upload.storageKey);
    await this.prisma.upload.delete({ where: { token } });
  }
}
