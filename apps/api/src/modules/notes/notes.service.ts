import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

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
