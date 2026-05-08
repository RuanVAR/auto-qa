import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as archiverModule from 'archiver';
const archiver = (archiverModule as unknown as { default?: typeof archiverModule } & typeof archiverModule).default ?? archiverModule;
import { Readable } from 'node:stream';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ImportExportService } from '../import-export.service';
import { PluginService } from '../../../plugins/plugin.service';
import { buildStepTypesMarkdown } from './step-types';

type Scope = 'project' | 'module' | 'feature';

type DataAnalysis = {
  testCount: number;
  testsByType: Record<string, number>;
  avgStepCount: number;
  topTags: Array<{ tag: string; count: number }>;
  featureCount: number;
  moduleCount: number;
};

/**
 * AI-friendly export bundler. Produces a zip with:
 *
 *   data.json         — same envelope as the regular exporter (round-trip safe)
 *   README.md         — agent prompt + observed-conventions analysis of THIS export
 *   conventions/      — hand-written + enum-generated specs
 *   docs/             — local Doc rows + linked DocLink markdown (best-effort fetch)
 *   ticket-context/   — fetchTicketContext per linked feature (description + AC)
 *   examples/         — first 3 well-formed tests from data.json + a README explaining style
 *
 * Two outputs:
 *   buildZip(...)  → Readable stream of the .zip
 *   buildPrompt(...)→ plain text (README + conventions concatenated) for paste-into-LLM
 */
@Injectable()
export class AIExportService {
  private readonly logger = new Logger(AIExportService.name);

  /** Cached at first use so disk IO doesn't run on every export call. */
  private conventionsCache: Map<string, string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly exporter: ImportExportService,
    private readonly plugins: PluginService,
  ) {}

  // ── Public API ───────────────────────────────────────────────────────────

  async buildZip(scope: Scope, scopeId: string): Promise<{ stream: Readable; filename: string }> {
    const ctx = await this.gather(scope, scopeId);
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.append(JSON.stringify(ctx.data, null, 2), { name: 'data.json' });
    archive.append(ctx.readme, { name: 'README.md' });

    const conventions = await this.loadConventions();
    for (const [name, content] of conventions) {
      archive.append(content, { name: `conventions/${name}` });
    }
    archive.append(buildStepTypesMarkdown(), { name: 'conventions/02-step-types.md' });

    for (const doc of ctx.docs) {
      archive.append(doc.content, { name: `docs/${slug(doc.filename)}` });
    }
    for (const tc of ctx.ticketContext) {
      archive.append(tc.markdown, { name: `ticket-context/${slug(tc.filename)}` });
    }
    for (const ex of ctx.examples) {
      archive.append(JSON.stringify(ex.test, null, 2), { name: `examples/${slug(ex.filename)}` });
    }
    if (ctx.examples.length > 0) {
      archive.append(ctx.examplesReadme, { name: 'examples/README.md' });
    }

    archive.finalize();

    const filename = `qa-ai-export--${scope}-${slug(ctx.scopeName)}--${new Date().toISOString().split('T')[0]}.zip`;
    return { stream: archive as unknown as Readable, filename };
  }

  /** Plain-text concat of README + conventions for paste-into-LLM. */
  async buildPrompt(scope: Scope, scopeId: string): Promise<string> {
    const ctx = await this.gather(scope, scopeId);
    const conventions = await this.loadConventions();
    const parts: string[] = [];
    parts.push(ctx.readme, '');
    parts.push('---', '');
    for (const [name, content] of conventions) {
      parts.push(`# ${name}`, '', content, '');
    }
    parts.push('# 02-step-types.md', '', buildStepTypesMarkdown());
    return parts.join('\n');
  }

  // ── Bundle gathering (single pass, then both zip + prompt use the result) ──

  private async gather(scope: Scope, scopeId: string) {
    const data = await this.exportData(scope, scopeId);
    const scopeName = this.extractScopeName(scope, data);
    const docs = await this.gatherDocs(scope, scopeId);
    const ticketContext = await this.gatherTicketContext(scope, scopeId);
    const analysis = this.analyseData(data);
    const examples = this.pickExamples(data);
    const examplesReadme = this.exampleReadme(analysis);
    const readme = this.buildReadme(scope, scopeName, analysis, docs.length, ticketContext.length);
    return { data, scopeName, docs, ticketContext, examples, examplesReadme, readme };
  }

  private async exportData(scope: Scope, scopeId: string): Promise<unknown> {
    if (scope === 'project') return this.exporter.exportProject(scopeId);
    if (scope === 'module') return this.exporter.exportModule(scopeId);
    return this.exporter.exportFeature(scopeId);
  }

  private extractScopeName(scope: Scope, data: unknown): string {
    const env = data as { project?: { name: string }; module?: { name: string }; feature?: { name: string } };
    if (scope === 'project') return env.project?.name ?? 'project';
    if (scope === 'module') return env.module?.name ?? 'module';
    return env.feature?.name ?? 'feature';
  }

  // ── Docs ─────────────────────────────────────────────────────────────────

  private async gatherDocs(scope: Scope, scopeId: string): Promise<Array<{ filename: string; content: string }>> {
    const out: Array<{ filename: string; content: string }> = [];
    const where = await this.docScopeWhere(scope, scopeId);

    const local = await this.prisma.doc.findMany({ where: { ...where, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    for (const d of local) {
      out.push({
        filename: `${scope}--${d.title || 'untitled'}--local.md`,
        content: `# ${d.title}\n\n${d.summary ? `_${d.summary}_\n\n` : ''}${d.markdown}`,
      });
    }

    const linked = await this.prisma.docLink.findMany({ where: { ...where, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    for (const l of linked) {
      let body = l.cachedMarkdown ?? '';
      if (!body) {
        try {
          const result = await this.plugins.dispatch<{ markdown: string }>(
            'fetchDoc',
            l.installId,
            { externalId: l.externalId, pageId: l.pageId ?? undefined },
            {},
          );
          body = result.markdown ?? '';
        } catch (err) {
          this.logger.warn(`AI export: fetchDoc fallback failed for ${l.externalId}: ${(err as Error).message}`);
          body = '_(content unavailable — refresh the link in the platform to populate cache)_';
        }
      }
      out.push({
        filename: `${scope}--${l.title}--linked.md`,
        content: `# ${l.title}\n\nSource: [${l.externalUrl}](${l.externalUrl})\n\n${body}`,
      });
    }
    return out;
  }

  private async docScopeWhere(
    scope: Scope,
    scopeId: string,
  ): Promise<{ projectId?: string; moduleId?: string; featureId?: string }> {
    if (scope === 'project') return { projectId: scopeId };
    if (scope === 'module') return { moduleId: scopeId };
    return { featureId: scopeId };
  }

  // ── Ticket context (linked ClickUp tasks for features in scope) ──────────

  private async gatherTicketContext(scope: Scope, scopeId: string): Promise<Array<{ filename: string; markdown: string }>> {
    // Resolve every featureId in scope.
    const featureIds: string[] = [];
    if (scope === 'feature') {
      featureIds.push(scopeId);
    } else if (scope === 'module') {
      const features = await this.prisma.feature.findMany({ where: { moduleId: scopeId, deletedAt: null }, select: { id: true } });
      featureIds.push(...features.map((f) => f.id));
    } else {
      const modules = await this.prisma.module.findMany({
        where: { projectId: scopeId, deletedAt: null },
        select: { features: { where: { deletedAt: null }, select: { id: true } } },
      });
      for (const m of modules) for (const f of m.features) featureIds.push(f.id);
    }
    if (featureIds.length === 0) return [];

    // Pull TicketLinks for those features.
    const links = await this.prisma.ticketLink.findMany({
      where: { featureId: { in: featureIds }, deletedAt: null },
      include: { feature: { select: { name: true } } },
    });
    if (links.length === 0) return [];

    const out: Array<{ filename: string; markdown: string }> = [];
    for (const link of links) {
      try {
        const ctx = await this.plugins.dispatch<{
          title: string;
          descriptionMarkdown: string;
          comments?: Array<{ author: string; body: string; createdAt: string }>;
          acceptanceCriteria?: string[];
        }>('fetchTicketContext', link.installId, { externalId: link.externalId, includeComments: false }, {});
        const lines: string[] = [
          `# ${link.feature?.name ?? 'feature'} — ticket context`,
          '',
          `Source: [${link.externalUrl}](${link.externalUrl})`,
          '',
          '## Description',
          '',
          ctx.descriptionMarkdown || '_(no description)_',
        ];
        if (ctx.acceptanceCriteria && ctx.acceptanceCriteria.length > 0) {
          lines.push('', '## Acceptance criteria', '');
          for (const ac of ctx.acceptanceCriteria) lines.push(`- ${ac}`);
        }
        // Include external id in filename to avoid collisions when two
        // features have the same name (or a feature has multiple links).
        const baseName = link.feature?.name ?? 'feature';
        out.push({
          filename: `${baseName}--${link.externalId}.md`,
          markdown: lines.join('\n'),
        });
      } catch (err) {
        this.logger.warn(`AI export: fetchTicketContext failed for ${link.externalId}: ${(err as Error).message}`);
      }
    }
    return out;
  }

  // ── Conventions disk loader ─────────────────────────────────────────────

  private async loadConventions(): Promise<Map<string, string>> {
    if (this.conventionsCache) return this.conventionsCache;
    const dir = path.join(__dirname, 'conventions');
    const out = new Map<string, string>();
    try {
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort();
      for (const f of files) {
        out.set(f, await fs.readFile(path.join(dir, f), 'utf8'));
      }
    } catch (err) {
      this.logger.warn(`Conventions dir read failed: ${(err as Error).message}`);
    }
    this.conventionsCache = out;
    return out;
  }

  // ── Data analysis (drives the README's observed-conventions section) ────

  private analyseData(data: unknown): DataAnalysis {
    const env = data as {
      project?: { modules?: ModuleShape[] };
      module?: ModuleShape;
      feature?: FeatureShape;
    };

    const modules: ModuleShape[] = env.project?.modules ?? (env.module ? [env.module] : []);
    const features: FeatureShape[] = env.feature
      ? [env.feature]
      : modules.flatMap((m) => m.features ?? []);
    const tests: TestShape[] = features.flatMap((f) => f.testDefinitions ?? f.tests ?? []);

    const testsByType: Record<string, number> = {};
    let totalSteps = 0;
    const tagCounts = new Map<string, number>();

    for (const t of tests) {
      testsByType[t.type ?? 'UI'] = (testsByType[t.type ?? 'UI'] ?? 0) + 1;
      totalSteps += Array.isArray(t.steps) ? t.steps.length : 0;
      for (const tag of t.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count }));

    return {
      testCount: tests.length,
      testsByType,
      avgStepCount: tests.length === 0 ? 0 : totalSteps / tests.length,
      topTags,
      featureCount: features.length,
      moduleCount: modules.length,
    };
  }

  private pickExamples(data: unknown): Array<{ filename: string; test: TestShape }> {
    const env = data as { project?: { modules?: ModuleShape[] }; module?: ModuleShape; feature?: FeatureShape };
    const modules: ModuleShape[] = env.project?.modules ?? (env.module ? [env.module] : []);
    const features: FeatureShape[] = env.feature ? [env.feature] : modules.flatMap((m) => m.features ?? []);
    const tests: TestShape[] = features.flatMap((f) => f.testDefinitions ?? f.tests ?? []);

    // Filter for "well-formed" — has steps, not draft, has tags
    const wellFormed = tests.filter((t) => Array.isArray(t.steps) && t.steps.length > 0 && t.tags && t.tags.length > 0);
    return wellFormed.slice(0, 3).map((t, i) => ({ filename: `${i + 1}--${t.name || 'test'}.json`, test: t }));
  }

  private exampleReadme(analysis: DataAnalysis): string {
    return [
      '# Examples — match this team\'s style',
      '',
      'These are the first three "well-formed" tests pulled from the export',
      '(have steps, have tags). When generating new tests, look at:',
      '',
      '- step ordering',
      '- selector style (data-testid prefix? aria roles? CSS?)',
      '- assertion placement (interleaved with actions, or batched at the end?)',
      '- naming voice (active / passive)',
      '- tag vocabulary',
      '',
      `Across the export: ${analysis.testCount} tests, avg ${analysis.avgStepCount.toFixed(1)}`,
      `steps each. Type mix: ${formatTypeMix(analysis.testsByType)}.`,
      analysis.topTags.length > 0
        ? `Top tags: ${analysis.topTags.map((t) => `\`${t.tag}\` (${t.count})`).join(', ')}.`
        : 'No tag data found.',
    ].join('\n');
  }

  // ── README — agent prompt with injected analysis ─────────────────────────

  private buildReadme(
    scope: Scope,
    scopeName: string,
    a: DataAnalysis,
    docCount: number,
    ticketContextCount: number,
  ): string {
    return [
      `# QA Platform — AI Import Bundle (${scope}: ${scopeName})`,
      '',
      'You are an AI agent receiving an export of a QA scope. The user wants',
      'you to generate new modules / features / tests that fit cleanly back',
      'into the platform when re-imported.',
      '',
      '## What\'s in this bundle',
      '',
      '- `data.json` — the structured export (round-trip safe)',
      `- \`docs/\` — ${docCount} doc${docCount === 1 ? '' : 's'} (local + linked)`,
      `- \`ticket-context/\` — ${ticketContextCount} ClickUp ticket descriptions + AC sections`,
      '- `conventions/` — the platform\'s data model, step types, and authoring rules',
      '- `examples/` — well-formed tests pulled from THIS export, to match the team\'s style',
      '',
      '## Hard rules',
      '',
      '1. Every test must have `name`, `type` ∈ {UI, API, SHELL}, `tags`, `steps`.',
      '2. Each step\'s `type` MUST match a value in `conventions/02-step-types.md`.',
      '3. Don\'t set `id`, `createdAt`, `updatedAt`, `featureId`. The importer assigns them.',
      '4. Match-by-name idempotency — re-importing your output is additive only; existing items stay.',
      '5. See `conventions/05-import-rules.md` for the full reject criteria.',
      '',
      '## Soft rules — match THIS team\'s style',
      '',
      `- Existing tests in this export: **${a.testCount}** across **${a.featureCount}** feature${a.featureCount === 1 ? '' : 's'}.`,
      `- Average steps per test: **${a.avgStepCount.toFixed(1)}**.`,
      `- Type mix: ${formatTypeMix(a.testsByType)}.`,
      a.topTags.length > 0
        ? `- Common tags: ${a.topTags.map((t) => `\`${t.tag}\` (${t.count})`).join(', ')}.`
        : '- No tag patterns yet — pick from the suggestions in conventions/04-test-anatomy.md.',
      '- Look at `examples/` for the team\'s selector + naming + ordering style.',
      '',
      '## When the user asks for new content',
      '',
      'Produce JSON matching the shape in `conventions/04-test-anatomy.md`.',
      'Reference existing items by **name** in your reasoning (so the importer',
      'matches them and slots new tests in alongside).',
      '',
      'Use `docs/` and `ticket-context/` as the source of truth for behaviour;',
      'don\'t invent acceptance criteria not present in the bundle.',
      '',
      '## Re-import',
      '',
      'After you produce content, the user re-imports via the platform\'s normal',
      'import endpoint. Your output should match the same envelope shape as',
      '`data.json`. Existing items dedupe by name automatically.',
    ].join('\n');
  }
}

// ── Local types for envelope walking ─────────────────────────────────────────

type ModuleShape = { name: string; features?: FeatureShape[] };
type FeatureShape = { name: string; testDefinitions?: TestShape[]; tests?: TestShape[] };
type TestShape = { name: string; type?: string; tags?: string[]; steps?: unknown[] };

// ── Helpers ──────────────────────────────────────────────────────────────────

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function formatTypeMix(byType: Record<string, number>): string {
  const total = Object.values(byType).reduce((a, b) => a + b, 0);
  if (total === 0) return 'none yet';
  return Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${type} ${Math.round((n / total) * 100)}%`)
    .join(', ');
}
