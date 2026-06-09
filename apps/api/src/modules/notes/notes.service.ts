import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvAccessService } from '../../common/access/env-access.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';

type TestNoteView = { content: string; updatedAt: Date | null; lastEditedBy: string | null };

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envAccess: EnvAccessService,
  ) {}

  // ── Shared per-test note (the "Test notes" tab) ─────────────────────────────

  private assertProject(user: JwtPayload, projectId: string) {
    return this.envAccess.assertProjectAccess(user.sub, projectId, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
      orgId: user.activeOrgId ?? null,
    });
  }

  private async projectIdOfTest(testId: string): Promise<string> {
    const t = await this.prisma.testDefinition.findFirst({ where: { id: testId, deletedAt: null }, select: { projectId: true } });
    if (!t) throw new NotFoundException('Test not found');
    return t.projectId;
  }

  async getTestNote(user: JwtPayload, testId: string): Promise<TestNoteView> {
    await this.assertProject(user, await this.projectIdOfTest(testId));
    const note = await this.prisma.testNote.findUnique({
      where: { testDefinitionId: testId },
      select: { content: true, updatedAt: true, lastEditedBy: { select: { name: true } } },
    });
    return { content: note?.content ?? '', updatedAt: note?.updatedAt ?? null, lastEditedBy: note?.lastEditedBy?.name ?? null };
  }

  async upsertTestNote(user: JwtPayload, testId: string, content: string): Promise<TestNoteView> {
    await this.assertProject(user, await this.projectIdOfTest(testId));
    const note = await this.prisma.testNote.upsert({
      where: { testDefinitionId: testId },
      create: { testDefinitionId: testId, content, lastEditedById: user.sub },
      update: { content, lastEditedById: user.sub },
      select: { content: true, updatedAt: true, lastEditedBy: { select: { name: true } } },
    });
    return { content: note.content, updatedAt: note.updatedAt, lastEditedBy: note.lastEditedBy?.name ?? null };
  }

  /** Test ids in this feature that have a non-empty shared note (sidebar badge). */
  async testNotePresence(user: JwtPayload, featureId: string): Promise<string[]> {
    const feature = await this.prisma.feature.findFirst({ where: { id: featureId, deletedAt: null }, select: { module: { select: { projectId: true } } } });
    if (!feature) throw new NotFoundException('Feature not found');
    await this.assertProject(user, feature.module.projectId);
    const notes = await this.prisma.testNote.findMany({
      where: { test: { featureId, deletedAt: null }, NOT: { content: '' } },
      select: { testDefinitionId: true },
    });
    return notes.map((n) => n.testDefinitionId);
  }

  async getNote(userId: string, projectId: string): Promise<{ content: string }> {
    const note = await this.prisma.userProjectNote.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { content: true },
    });
    return { content: note?.content ?? '' };
  }

  async upsertNote(userId: string, projectId: string, content: string): Promise<{ content: string }> {
    const note = await this.prisma.userProjectNote.upsert({
      where: { userId_projectId: { userId, projectId } },
      create: { userId, projectId, content },
      update: { content },
      select: { content: true },
    });
    return { content: note.content };
  }
}
