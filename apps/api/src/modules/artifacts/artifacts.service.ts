import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageProvider } from '@qa-platform/storage';

/** DI token for the artifact-scoped storage provider (ARTIFACT_STORAGE_PATH base). */
export const ARTIFACT_STORAGE = 'ARTIFACT_STORAGE';

@Injectable()
export class ArtifactsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ARTIFACT_STORAGE) private readonly storage: StorageProvider,
  ) {}

  findByRun(runId: string) {
    return this.prisma.artifact.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
  }

  async findOne(id: string) {
    const a = await this.prisma.artifact.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Artifact not found');
    return a;
  }

  /**
   * Opens an artifact for streaming through the configured storage backend.
   * Mirrors UploadsService.openDownload() — returns metadata plus full and
   * ranged stream factories so the controller can serve HTTP Range requests
   * regardless of whether the backend is local disk or a cloud bucket.
   */
  async openArtifact(id: string) {
    const a = await this.findOne(id);
    this.validateKey(a.path);
    if (!(await this.storage.exists(a.path)))
      throw new NotFoundException('Artifact file not found');
    const size = a.sizeBytes ?? (await this.storage.getSize(a.path));
    return {
      mimeType: a.mimeType ?? 'application/octet-stream',
      filename: a.filename,
      size,
      streamFull: () => this.storage.stream(a.path),
      streamRange: (start: number, end: number) => this.storage.streamRange(a.path, start, end),
    };
  }

  /**
   * Storage keys are relative, slash-delimited paths. Reject traversal or
   * absolute keys before they reach a provider (the local provider would
   * otherwise resolve outside its base dir; cloud providers would create
   * oddly-named objects). Preserves the guard the old fs-based getFilePath had.
   */
  private validateKey(key: string): void {
    const segments = key.split(/[\\/]/);
    if (key.startsWith('/') || key.startsWith('\\') || segments.includes('..')) {
      throw new BadRequestException('Artifact path traversal detected');
    }
  }
}
