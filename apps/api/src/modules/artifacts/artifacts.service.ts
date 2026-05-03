import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class ArtifactsService {
  private readonly storagePath: string;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {
    this.storagePath = this.config.get<string>('ARTIFACT_STORAGE_PATH', './artifacts');
    fs.mkdirSync(this.storagePath, { recursive: true });
  }

  findByRun(runId: string) {
    return this.prisma.artifact.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
  }

  async findOne(id: string) {
    const a = await this.prisma.artifact.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Artifact not found');
    return a;
  }

  async getFilePath(id: string): Promise<string> {
    const a = await this.findOne(id);
    const full = this.safeJoin(this.storagePath, a.path);
    if (!fs.existsSync(full)) throw new NotFoundException('Artifact file not found on disk');
    return full;
  }

  getRunStorageDir(runId: string): string {
    const dir = this.safeJoin(this.storagePath, 'runs', runId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Resolves the provided path segments relative to `base` and throws if
   * the resolved path escapes the base directory (directory traversal guard).
   */
  private safeJoin(base: string, ...segments: string[]): string {
    const resolved = path.resolve(base, ...segments);
    const normalBase = path.resolve(base);
    if (!resolved.startsWith(normalBase + path.sep) && resolved !== normalBase) {
      throw new BadRequestException('Artifact path traversal detected');
    }
    return resolved;
  }
}
