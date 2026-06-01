import { PrismaClient, ArtifactType, Prisma } from '@prisma/client';
import { StorageProvider } from '@qa-platform/storage';
import * as fs from 'fs';
import * as path from 'path';

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.zip': 'application/zip', '.webm': 'video/webm', '.log': 'text/plain' };

export class ArtifactCollector {
  /**
   * @param runDir A LOCAL temp staging directory where Playwright writes
   *   screenshots / traces. It is NOT the final location — register()
   *   uploads each file through the storage provider and then deletes the
   *   local copy. The provider decides where it actually lives (local disk
   *   under ARTIFACT_STORAGE_PATH, or an S3/GCS/Azure bucket).
   */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly runId: string,
    public readonly runDir: string,
    private readonly storage: StorageProvider,
  ) {
    fs.mkdirSync(runDir, { recursive: true });
  }

  /**
   * Capture-then-upload: Playwright can only write to local disk, so the
   * file already exists at `fullPath`. We upload it under a stable storage
   * key (`runs/<runId>/<filename>`), record the key on the artifact row,
   * then remove the local temp copy.
   *
   * @param metadata Optional structured info — e.g. { stepIndex, stepName,
   *   trigger: 'manual' | 'failure' }. Surfaced in the artifact list so the
   *   UI can pin a screenshot to its specific step row without having to
   *   parse the filename.
   */
  async register(
    type: string,
    filename: string,
    fullPath: string,
    metadata?: Record<string, unknown>,
  ) {
    if (!fs.existsSync(fullPath)) return;
    const stats = fs.statSync(fullPath);
    const ext = path.extname(filename).toLowerCase();
    const mimeType = MIME[ext] ?? 'application/octet-stream';
    // Forward-slash key — works as both a relative disk path and an object key.
    const key = `runs/${this.runId}/${filename}`;

    await this.storage.uploadFile(key, fullPath, mimeType);

    const record = await this.prisma.artifact.create({
      data: {
        runId: this.runId,
        type: type as ArtifactType,
        filename,
        path: key,
        mimeType,
        sizeBytes: stats.size,
        ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      },
    });

    // Persisted in storage — drop the local staging copy. Best-effort: the
    // executor also rm -rf's the whole staging dir at the end of the run.
    fs.promises.unlink(fullPath).catch(() => {});

    return record;
  }
}
