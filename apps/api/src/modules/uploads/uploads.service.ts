import { Injectable, NotFoundException, GoneException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageProvider } from '@qa-platform/storage';
import { ConfigService } from '@nestjs/config';
import { v4 as uuid } from 'uuid';
import { apiUrl } from '../../common/config/urls';
import * as path from 'path';
import { streamToBuffer } from '../../common/util/stream';

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
    return {
      id: record.id,
      token: record.token,
      url: `${apiUrl()}/api/v1/uploads/${record.token}`,
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
    // The DB row can outlive the file (volume reset, pruned, never written).
    // Catch it HERE — before the controller sets the file's content-type — so a
    // missing file is a clean 404, not a stream error mid-send that Fastify
    // can't serialize (FST_ERR_REP_INVALID_PAYLOAD_TYPE).
    if (!(await this.storage.exists(upload.storageKey))) {
      throw new NotFoundException('This file is no longer available.');
    }
    return {
      mimeType: upload.mimeType,
      filename: upload.filename,
      size: upload.sizeBytes,
      streamFull: () => this.storage.stream(upload.storageKey),
      streamRange: (start: number, end: number) =>
        this.storage.streamRange(upload.storageKey, start, end),
    };
  }

  /**
   * Read an upload by token as a base64 data URL — for embedding in generated
   * documents (e.g. the sign-off certificate PDF) where the worker's headless
   * browser can't reliably fetch the upload over the network. Returns null if
   * the token doesn't resolve.
   */
  async getDataUrl(token: string): Promise<string | null> {
    try {
      const upload = await this.resolveUpload(token);
      const stream = await this.storage.stream(upload.storageKey);
      const buf = await streamToBuffer(stream);
      return `data:${upload.mimeType};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }

  async remove(token: string) {
    const upload = await this.prisma.upload.findUnique({ where: { token } });
    if (!upload) throw new NotFoundException('File not found');
    await this.storage.delete(upload.storageKey);
    await this.prisma.upload.delete({ where: { token } });
  }
}
