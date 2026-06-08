import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvAccessService } from '../../common/access/env-access.service';

export interface AccessCtx {
  userId: string;
  jwtRoleHint?: { orgRole?: string | null; platformRole?: string | null };
  orgId?: string | null;
}

type Doc = { title: string; markdown: string };

/**
 * Read-only "test/feature + its context + docs" assembler — the shape the MCP
 * `get_*_context` tools surface and what a developer wants when writing code
 * against a feature. Mirrors the AI pipeline's gatherSources merge (dedupe docs
 * by title across the item + its feature, internal Doc.markdown + external
 * DocLink.cachedMarkdown) but is RBAC-checked and decoupled from AI generation.
 */
@Injectable()
export class ContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envAccess: EnvAccessService,
  ) {}

  async forTest(testId: string, ctx: AccessCtx) {
    const test = await this.prisma.testDefinition.findFirst({
      where: { id: testId, deletedAt: null },
      select: {
        id: true, name: true, description: true, type: true, tags: true, steps: true, projectId: true,
        project: { select: { name: true } },
        docs: { select: { title: true, markdown: true } },
        docLinks: { select: { title: true, cachedMarkdown: true } },
        feature: {
          select: {
            id: true, name: true, description: true,
            module: { select: { name: true } },
            docs: { select: { title: true, markdown: true } },
            docLinks: { select: { title: true, cachedMarkdown: true } },
          },
        },
      },
    });
    if (!test) throw new NotFoundException('Test not found');
    await this.assert(test.projectId, ctx);

    const docs = this.mergeDocs([
      ...(test.docs ?? []),
      ...(test.feature?.docs ?? []),
      ...mapDocLinks(test.docLinks),
      ...mapDocLinks(test.feature?.docLinks),
    ]);

    return {
      item: 'test' as const,
      scope: { project: test.project?.name ?? null, module: test.feature?.module?.name ?? null, feature: test.feature?.name ?? null },
      test: { id: test.id, name: test.name, description: test.description, type: test.type, tags: test.tags, steps: test.steps },
      feature: test.feature ? { id: test.feature.id, name: test.feature.name, description: test.feature.description } : null,
      acceptanceCriteria: test.description ?? null,
      docs,
    };
  }

  async forFeature(featureId: string, ctx: AccessCtx) {
    const feature = await this.prisma.feature.findFirst({
      where: { id: featureId, deletedAt: null },
      select: {
        id: true, name: true, description: true, tags: true,
        module: { select: { name: true, projectId: true, project: { select: { name: true } } } },
        docs: { select: { title: true, markdown: true } },
        docLinks: { select: { title: true, cachedMarkdown: true } },
        testDefinitions: { where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!feature) throw new NotFoundException('Feature not found');
    await this.assert(feature.module.projectId, ctx);

    const docs = this.mergeDocs([...(feature.docs ?? []), ...mapDocLinks(feature.docLinks)]);

    return {
      item: 'feature' as const,
      scope: { project: feature.module.project?.name ?? null, module: feature.module.name, feature: feature.name },
      feature: { id: feature.id, name: feature.name, description: feature.description, tags: feature.tags },
      acceptanceCriteria: feature.description ?? null,
      docs,
      tests: feature.testDefinitions,
    };
  }

  private assert(projectId: string, ctx: AccessCtx) {
    return this.envAccess.assertProjectAccess(ctx.userId, projectId, {
      jwtRoleHint: ctx.jwtRoleHint,
      orgId: ctx.orgId ?? null,
    });
  }

  private mergeDocs(all: Array<Doc | null>): Doc[] {
    const seen = new Set<string>();
    const out: Doc[] = [];
    for (const d of all) {
      if (!d || !d.title || !d.markdown) continue;
      if (seen.has(d.title)) continue;
      seen.add(d.title);
      out.push(d);
    }
    return out;
  }
}

function mapDocLinks(links?: Array<{ title: string; cachedMarkdown: string | null }>): Array<Doc | null> {
  return (links ?? []).map((l) => (l.cachedMarkdown ? { title: l.title, markdown: l.cachedMarkdown } : null));
}
