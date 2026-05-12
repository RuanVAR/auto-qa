import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PluginService } from '../../plugins/plugin.service';
import { listSections, sliceSection, hashContent, listSectionItems, sliceItem } from './markdown-slicer';

interface FetchDocResult {
  externalId: string;
  externalUrl: string;
  title: string;
  markdown: string;
  updatedAt: string;
}

@Injectable()
export class AcLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plugins: PluginService,
  ) {}

  /** Resolve the ClickUp install for a test's org (single-install assumption). */
  private async resolveInstall(testId: string): Promise<{ installId: string | null }> {
    const test = await this.prisma.testDefinition.findUnique({
      where: { id: testId },
      select: { project: { select: { orgId: true } } },
    });
    if (!test) throw new NotFoundException('Test not found');
    if (!test.project.orgId) return { installId: null };

    const install = await this.prisma.orgPluginInstall.findFirst({
      where: {
        orgId: test.project.orgId,
        pluginId: 'clickup',
        isEnabled: true,
        deletedAt: null,
      },
      select: { id: true, lastHealthOk: true },
    });
    if (!install || !install.lastHealthOk) return { installId: null };
    return { installId: install.id };
  }

  async getLink(testId: string) {
    const link = await this.prisma.testAcSourceLink.findUnique({ where: { testId } });
    const { installId } = await this.resolveInstall(testId);
    return { link, availableInstallId: installId };
  }

  async setLink(testId: string, body: {
    installId: string;
    docId: string;
    pageId: string;
    sectionSlug: string | null;
    pageTitle?: string | null;
    sectionTitle?: string | null;
    itemFingerprint?: string | null;
    itemTitle?: string | null;
    externalUrl: string;
  }) {
    // Verify the test exists and we can reach the install
    const test = await this.prisma.testDefinition.findUnique({ where: { id: testId }, select: { id: true } });
    if (!test) throw new NotFoundException('Test not found');

    return this.prisma.testAcSourceLink.upsert({
      where: { testId },
      create: {
        testId,
        installId: body.installId,
        docId: body.docId,
        pageId: body.pageId,
        sectionSlug: body.sectionSlug,
        pageTitle: body.pageTitle ?? null,
        sectionTitle: body.sectionTitle ?? null,
        itemFingerprint: body.itemFingerprint ?? null,
        itemTitle: body.itemTitle ?? null,
        externalUrl: body.externalUrl,
      },
      update: {
        installId: body.installId,
        docId: body.docId,
        pageId: body.pageId,
        sectionSlug: body.sectionSlug,
        pageTitle: body.pageTitle ?? null,
        sectionTitle: body.sectionTitle ?? null,
        itemFingerprint: body.itemFingerprint ?? null,
        itemTitle: body.itemTitle ?? null,
        externalUrl: body.externalUrl,
        // Replacing the link invalidates prior sync state
        lastSyncedAt: null,
        lastSyncedContent: null,
        lastSyncedHash: null,
        lastAppliedAt: null,
        lastAppliedHash: null,
      },
    });
  }

  async unlink(testId: string): Promise<{ ok: true }> {
    await this.prisma.testAcSourceLink.deleteMany({ where: { testId } });
    return { ok: true };
  }

  /** Fetch the latest content from ClickUp and store it as the pending slice. Does not modify test.description. */
  async sync(testId: string) {
    const link = await this.prisma.testAcSourceLink.findUnique({ where: { testId } });
    if (!link) throw new NotFoundException('No AC source linked');

    const fetched = await this.plugins.dispatch<FetchDocResult>(
      'fetchDoc',
      link.installId,
      { externalId: link.docId, pageId: link.pageId },
      {},
    );

    let sliced: string | null;
    if (link.itemFingerprint) {
      sliced = sliceItem(fetched.markdown, link.sectionSlug, link.itemFingerprint);
      if (sliced === null) {
        throw new BadRequestException(
          `Item "${link.itemTitle ?? '(unnamed)'}" no longer exists in section "${link.sectionTitle ?? link.sectionSlug ?? 'whole page'}". Its title may have been renamed or the item was removed — re-link via the picker.`,
        );
      }
    } else {
      sliced = sliceSection(fetched.markdown, link.sectionSlug);
      if (sliced === null) {
        throw new BadRequestException(
          `Section "${link.sectionTitle ?? link.sectionSlug}" no longer exists in the source page. It may have been renamed or removed in ClickUp.`,
        );
      }
    }

    const hash = hashContent(sliced);
    const updated = await this.prisma.testAcSourceLink.update({
      where: { id: link.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncedContent: sliced,
        lastSyncedHash: hash,
        // refresh page title in case it changed upstream
        pageTitle: fetched.title || link.pageTitle,
      },
    });

    // Also surface the current test.description so the UI can show a diff.
    const test = await this.prisma.testDefinition.findUnique({
      where: { id: testId },
      select: { description: true },
    });

    return {
      link: updated,
      currentDescription: test?.description ?? '',
      hasChanges: hash !== link.lastAppliedHash,
    };
  }

  /** Write the most recent synced content into test.description, snapshotting the previous value. */
  async apply(testId: string) {
    const link = await this.prisma.testAcSourceLink.findUnique({ where: { testId } });
    if (!link) throw new NotFoundException('No AC source linked');
    if (link.lastSyncedContent === null) {
      throw new BadRequestException('Nothing to apply — run sync first');
    }

    const test = await this.prisma.testDefinition.findUnique({
      where: { id: testId },
      select: { description: true },
    });

    await this.prisma.$transaction([
      this.prisma.testDefinition.update({
        where: { id: testId },
        data: { description: link.lastSyncedContent },
      }),
      this.prisma.testAcSourceLink.update({
        where: { id: link.id },
        data: {
          previousDescription: test?.description ?? null,
          previousAppliedAt: new Date(),
          lastAppliedAt: new Date(),
          lastAppliedHash: link.lastSyncedHash,
        },
      }),
    ]);

    return { ok: true };
  }

  /** Restore the previous description (one-step undo). 24h window. */
  async undo(testId: string): Promise<{ ok: true }> {
    const link = await this.prisma.testAcSourceLink.findUnique({ where: { testId } });
    if (!link) throw new NotFoundException('No AC source linked');
    if (!link.previousAppliedAt) throw new BadRequestException('Nothing to undo');
    const ageMs = Date.now() - link.previousAppliedAt.getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Undo window has expired (24h)');
    }

    await this.prisma.$transaction([
      this.prisma.testDefinition.update({
        where: { id: testId },
        data: { description: link.previousDescription ?? '' },
      }),
      this.prisma.testAcSourceLink.update({
        where: { id: link.id },
        data: {
          previousDescription: null,
          previousAppliedAt: null,
          lastAppliedAt: null,
          lastAppliedHash: null,
        },
      }),
    ]);
    return { ok: true };
  }

  /** List headings of a candidate page so the picker can show section options. */
  async listPageSections(testId: string, body: { installId: string; docId: string; pageId: string }) {
    const fetched = await this.plugins.dispatch<FetchDocResult>(
      'fetchDoc',
      body.installId,
      { externalId: body.docId, pageId: body.pageId },
      {},
    );
    const sections = listSections(fetched.markdown).map((s) => ({
      slug: s.slug,
      title: s.title,
      level: s.level,
    }));
    return { pageTitle: fetched.title, externalUrl: fetched.externalUrl, sections };
  }

  /**
   * List top-level items inside a section. For ClickUp AC sections that use a
   * numbered or bulleted list, each item maps to one candidate test description.
   * Returns an empty array if the section has no list structure (whole-section
   * link is still possible in that case).
   */
  async listSectionItems(_testId: string, body: { installId: string; docId: string; pageId: string; sectionSlug: string | null }) {
    const fetched = await this.plugins.dispatch<FetchDocResult>(
      'fetchDoc',
      body.installId,
      { externalId: body.docId, pageId: body.pageId },
      {},
    );
    const items = listSectionItems(fetched.markdown, body.sectionSlug);
    return { items };
  }
}
