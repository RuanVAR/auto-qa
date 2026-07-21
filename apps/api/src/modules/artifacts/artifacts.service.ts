import { Injectable, Inject, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { ArtifactType } from '@prisma/client';
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

  /** Resolve the owning run so controllers can enforce project/env access. */
  async getAccessScope(id: string): Promise<{ projectId: string; environmentId: string | null }> {
    const artifact = await this.prisma.artifact.findUnique({
      where: { id },
      select: { run: { select: { projectId: true, environmentId: true } } },
    });
    if (!artifact?.run) throw new NotFoundException('Artifact not found');
    return artifact.run;
  }

  /**
   * A trace viewer cannot attach the platform Bearer token to its own fetch.
   * Issue a short-lived, artifact-bound HMAC token instead. It is deliberately
   * not a session JWT and cannot be used for any other API endpoint.
   */
  async issueTraceViewerToken(id: string): Promise<string> {
    const artifact = await this.findOne(id);
    if (artifact.type !== ArtifactType.TRACE) throw new BadRequestException('Artifact is not a Playwright trace');
    const payload = Buffer.from(JSON.stringify({ artifactId: id, exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');
    return `${payload}.${this.signTracePayload(payload)}`;
  }

  async openTraceWithToken(id: string, token: string) {
    if (!this.isValidTraceToken(id, token)) throw new UnauthorizedException('Trace viewer token is invalid or expired');
    const artifact = await this.findOne(id);
    if (artifact.type !== ArtifactType.TRACE) throw new BadRequestException('Artifact is not a Playwright trace');
    return this.openArtifact(id);
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

  private signTracePayload(payload: string): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is required for trace viewer tokens');
    return createHmac('sha256', secret).update(`trace-viewer:${payload}`).digest('base64url');
  }

  private isValidTraceToken(id: string, token: string): boolean {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expected = this.signTracePayload(payload);
    const received = Buffer.from(signature);
    const signed = Buffer.from(expected);
    if (received.length !== signed.length || !timingSafeEqual(received, signed)) return false;
    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { artifactId?: string; exp?: number };
      return decoded.artifactId === id && typeof decoded.exp === 'number' && decoded.exp > Math.floor(Date.now() / 1000);
    } catch {
      return false;
    }
  }
}
