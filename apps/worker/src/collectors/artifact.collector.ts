import { PrismaClient, ArtifactType, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.zip': 'application/zip', '.webm': 'video/webm', '.log': 'text/plain' };

export class ArtifactCollector {
  constructor(private readonly prisma: PrismaClient, private readonly runId: string, public readonly runDir: string) {
    fs.mkdirSync(runDir, { recursive: true });
  }

  /**
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
    return this.prisma.artifact.create({
      data: {
        runId: this.runId,
        type: type as ArtifactType,
        filename,
        path: path.join('runs', this.runId, filename),
        mimeType: MIME[ext] ?? 'application/octet-stream',
        sizeBytes: stats.size,
        ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      },
    });
  }
}
