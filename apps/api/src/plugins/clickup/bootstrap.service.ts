import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PluginService } from '../plugin.service';

/**
 * "Bootstrap from ClickUp" — turn a ClickUp space into a Module / Feature /
 * TestDefinition tree on the platform.
 *
 *   ClickUp List         → Module (ModulePluginBinding pinned to list)
 *   Top-level Task       → Feature (FeaturePluginBinding subtask-mode + TicketLink)
 *   Subtask              → TestDefinition (blank stub, tagged `from-clickup:<id>`)
 *
 * Always idempotent:
 *   - Modules: matched on (project, install, defaultListId in ModulePluginBinding)
 *   - Features: matched on TicketLink.externalId
 *   - Tests: matched on `from-clickup:<id>` tag
 *
 * Re-running the same scope only creates what's new since the last run.
 *
 * Two phases:
 *   - preview(args)  reads ClickUp, returns plan + sample structure (no DB writes)
 *   - run(args)      performs the writes; reports counts + skipped + errors
 *
 * All reads go through PluginService.dispatch('listEntities', ...) using the
 * subtypes added on the ClickUp plugin (`list`, `list-tasks`, `subtasks`).
 * No raw HTTP from this service — keeps the plugin abstraction intact.
 */
@Injectable()
export class ClickUpBootstrapService {
  private readonly logger = new Logger(ClickUpBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plugins: PluginService,
  ) {}

  // ── Public surface ───────────────────────────────────────────────────────

  async preview(args: PreviewArgs): Promise<PreviewResult> {
    const binding = await this.resolveInstall(args.projectId);
    const installId = binding.installId;

    const lists = await this.pullLists(installId, args.scope);
    if (lists.length === 0) {
      return {
        lists: [],
        totals: { modules: 0, features: 0, tests: 0, skipped: { modules: 0, features: 0, tests: 0 } },
        samples: [],
      };
    }

    // Used to count "already imported" features for the skipped breakdown.
    const existingLinks = await this.prisma.ticketLink.findMany({
      where: { installId, deletedAt: null },
      select: { externalId: true },
    });
    const linkedExternalIds = new Set(existingLinks.map((l) => l.externalId));

    let totalFeaturesNew = 0;
    let totalFeaturesSkipped = 0;
    let totalTestsNew = 0;
    const sampleListBlocks: SampleListBlock[] = [];
    let listsAlreadyHaveModule = 0;

    for (const list of lists) {
      const moduleAlreadyExists = await this.moduleExistsForList(args.projectId, installId, list.id);
      if (moduleAlreadyExists) listsAlreadyHaveModule++;

      let topTasks: ClickUpListedTask[] = [];
      if (args.depth === 'feature' || args.depth === 'test') {
        topTasks = await this.pullListTasks(installId, list.id);
      }

      const sampleFeatures: SampleFeatureBlock[] = [];
      let listTestCount = 0;

      for (let fi = 0; fi < topTasks.length; fi++) {
        const task = topTasks[fi];
        if (linkedExternalIds.has(task.id)) totalFeaturesSkipped++;
        else totalFeaturesNew++;

        if (args.depth === 'test') {
          const subs = await this.pullSubtasks(installId, task.id);
          listTestCount += subs.length;
          totalTestsNew += subs.length;
          if (fi < 2) {
            sampleFeatures.push({
              taskId: task.id,
              taskName: task.name,
              tests: subs.slice(0, 2).map((s) => ({ id: s.id, name: s.name })),
              moreTests: Math.max(0, subs.length - 2),
            });
          }
        } else if (args.depth === 'feature' && fi < 2) {
          sampleFeatures.push({ taskId: task.id, taskName: task.name, tests: [], moreTests: 0 });
        }
      }

      sampleListBlocks.push({
        listId: list.id,
        listName: list.name,
        moduleAlreadyExists,
        topTasksCount: topTasks.length,
        testsCount: listTestCount,
        sampleFeatures,
      });
    }

    return {
      lists: sampleListBlocks.map((b) => ({ id: b.listId, name: b.listName, alreadyImported: b.moduleAlreadyExists })),
      totals: {
        modules: lists.length - listsAlreadyHaveModule,
        features: totalFeaturesNew,
        tests: totalTestsNew,
        skipped: {
          modules: listsAlreadyHaveModule,
          features: totalFeaturesSkipped,
          // Tests: we don't pre-check tag matches in preview to avoid N+1 SQL
          // queries. Run() handles the actual dedup; preview overestimates new tests.
          tests: 0,
        },
      },
      samples: sampleListBlocks,
    };
  }

  async run(args: RunArgs): Promise<RunResult> {
    const binding = await this.resolveInstall(args.projectId);
    const installId = binding.installId;
    const orgId = binding.install.orgId;

    const lists = await this.pullLists(installId, args.scope);
    const existingLinks = await this.prisma.ticketLink.findMany({
      where: { installId, deletedAt: null },
      select: { externalId: true, featureId: true },
    });
    const linkedExternalIdToFeatureId = new Map(
      existingLinks.filter((l) => l.featureId).map((l) => [l.externalId, l.featureId!] as const),
    );

    const result: RunResult = {
      created: { modules: 0, features: 0, tests: 0 },
      skipped: { modules: 0, features: 0, tests: 0 },
      errors: [],
    };
    const tagPrefix = args.tagPrefix ?? 'from-clickup';
    const moduleTags = ['from-clickup'];

    for (const list of lists) {
      // When depth >= 'feature', skip empty lists — creating an empty module
      // for an empty ClickUp list is just noise. depth='module' is opt-in
      // for that pattern (user wants the scaffolding regardless).
      let topTasks: ClickUpListedTask[] = [];
      if (args.depth !== 'module') {
        try {
          topTasks = await this.pullListTasks(installId, list.id);
        } catch (err) {
          result.errors.push({ scope: 'list-tasks', externalId: list.id, message: (err as Error).message });
          continue;
        }
        if (topTasks.length === 0) {
          // Skip silently — not surfaced as a module skip since we never
          // tried to create one.
          continue;
        }
      }

      let module: { id: string; created: boolean };
      try {
        module = await this.upsertModuleForList(args.projectId, installId, list, moduleTags);
      } catch (err) {
        result.errors.push({ scope: 'module', externalId: list.id, message: (err as Error).message });
        continue;
      }
      if (module.created) result.created.modules++;
      else result.skipped.modules++;

      if (args.depth === 'module') continue;

      for (const task of topTasks) {
        const existingFeatureId = linkedExternalIdToFeatureId.get(task.id);
        let featureId: string;

        if (existingFeatureId) {
          result.skipped.features++;
          featureId = existingFeatureId;
        } else {
          try {
            const feature = await this.createFeatureForTask(module.id, installId, orgId, task);
            featureId = feature.id;
            result.created.features++;
            linkedExternalIdToFeatureId.set(task.id, featureId);
          } catch (err) {
            result.errors.push({ scope: 'feature', externalId: task.id, message: (err as Error).message });
            continue;
          }
        }

        if (args.depth !== 'test') continue;

        let subs: ClickUpListedTask[] = [];
        try {
          subs = await this.pullSubtasks(installId, task.id);
        } catch (err) {
          result.errors.push({ scope: 'subtasks', externalId: task.id, message: (err as Error).message });
          continue;
        }

        for (const sub of subs) {
          try {
            const made = await this.createTestForSubtask(args.projectId, featureId, sub, moduleTags, tagPrefix);
            if (made) result.created.tests++;
            else result.skipped.tests++;
          } catch (err) {
            result.errors.push({ scope: 'test', externalId: sub.id, message: (err as Error).message });
          }
        }
      }
    }
    return result;
  }

  // ── Plugin pulls (all via dispatch — no raw HTTP) ────────────────────────

  private async resolveInstall(projectId: string) {
    const binding = await this.prisma.projectPluginBinding.findFirst({
      where: { projectId, deletedAt: null, install: { pluginId: 'clickup', isEnabled: true, lastHealthOk: true, deletedAt: null } },
      include: { install: { select: { id: true, orgId: true, config: true } } },
    });
    if (!binding) {
      throw new NotFoundException(
        'No healthy ClickUp project binding — install ClickUp under Org → Plugins, then bind it to this project under Integrations.',
      );
    }
    return binding;
  }

  private async pullLists(installId: string, scope: BootstrapScope): Promise<ClickUpListSummary[]> {
    if (scope.listIds && scope.listIds.length > 0) {
      // Caller provided exact list ids — fetch their names via list-statuses
      // call shape, which already returns list metadata indirectly. Easiest
      // path: pull the full list set and filter.
      const all = await this.pullAllListsFor(installId, scope);
      const wanted = new Set(scope.listIds);
      return all.filter((l) => wanted.has(l.id));
    }
    return this.pullAllListsFor(installId, scope);
  }

  private async pullAllListsFor(installId: string, scope: BootstrapScope): Promise<ClickUpListSummary[]> {
    if (scope.folderId) {
      const r = await this.plugins.dispatch<{ items: Array<{ id: string; label: string; meta?: { taskCount?: number } }> }>(
        'listEntities',
        installId,
        { kind: 'list', parent: { folderId: scope.folderId } },
      );
      return r.items.map((i) => ({ id: i.id, name: i.label, taskCount: Number(i.meta?.taskCount ?? 0) }));
    }
    if (scope.spaceId) {
      const r = await this.plugins.dispatch<{ items: Array<{ id: string; label: string; meta?: { taskCount?: number } }> }>(
        'listEntities',
        installId,
        { kind: 'list', parent: { spaceId: scope.spaceId, folderId: '__folderless__' } },
      );
      return r.items.map((i) => ({ id: i.id, name: i.label, taskCount: Number(i.meta?.taskCount ?? 0) }));
    }
    throw new BadRequestException('scope must include listIds, folderId, or spaceId');
  }

  private async pullListTasks(installId: string, listId: string): Promise<ClickUpListedTask[]> {
    const r = await this.plugins.dispatch<{ items: Array<{ id: string; label: string; meta?: { status?: string; hasDescription?: boolean } }> }>(
      'listEntities',
      installId,
      { kind: 'list-tasks', parent: { listId } },
    );
    return r.items.map((i) => ({
      id: i.id,
      name: i.label,
      status: i.meta?.status ?? '',
    }));
  }

  private async pullSubtasks(installId: string, taskId: string): Promise<ClickUpListedTask[]> {
    const r = await this.plugins.dispatch<{ items: Array<{ id: string; label: string; meta?: { status?: string } }> }>(
      'listEntities',
      installId,
      { kind: 'subtasks', parent: { taskId } },
    );
    return r.items.map((i) => ({ id: i.id, name: i.label, status: i.meta?.status ?? '' }));
  }

  // ── DB writes ────────────────────────────────────────────────────────────

  private async moduleExistsForList(projectId: string, installId: string, listId: string): Promise<boolean> {
    const bindings = await this.prisma.modulePluginBinding.findMany({
      where: {
        installId,
        deletedAt: null,
        module: { projectId, deletedAt: null },
      },
    });
    return bindings.some((b) => {
      const cfg = b.bindingConfig as Record<string, unknown> | null;
      return cfg?.['defaultListId'] === listId;
    });
  }

  private async upsertModuleForList(
    projectId: string,
    installId: string,
    list: ClickUpListSummary,
    baseTags: string[],
  ): Promise<{ id: string; created: boolean }> {
    // Existing? Match on a binding whose defaultListId === list.id under this project.
    const existingBindings = await this.prisma.modulePluginBinding.findMany({
      where: {
        installId,
        deletedAt: null,
        module: { projectId, deletedAt: null },
      },
      include: { module: { select: { id: true } } },
    });
    for (const b of existingBindings) {
      const cfg = b.bindingConfig as Record<string, unknown> | null;
      if (cfg?.['defaultListId'] === list.id && b.module) {
        return { id: b.module.id, created: false };
      }
    }

    // Create new module + binding.
    const maxOrder = await this.prisma.module.aggregate({
      where: { projectId, deletedAt: null },
      _max: { order: true },
    });
    const order = (maxOrder._max.order ?? -1) + 1;

    const module = await this.prisma.module.create({
      data: { projectId, name: list.name, order, tags: baseTags },
    });

    await this.prisma.modulePluginBinding.create({
      data: {
        moduleId: module.id,
        installId,
        bindingConfig: { defaultListId: list.id } as unknown as Prisma.InputJsonValue,
      },
    });

    return { id: module.id, created: true };
  }

  private async createFeatureForTask(
    moduleId: string,
    installId: string,
    orgId: string,
    task: ClickUpListedTask,
  ): Promise<{ id: string }> {
    let description: string | undefined;
    try {
      const ctx = await this.plugins.dispatch<{ descriptionMarkdown?: string }>(
        'fetchTicketContext',
        installId,
        { externalId: task.id, includeComments: false },
      );
      description = ctx.descriptionMarkdown || undefined;
    } catch {
      // best-effort
    }

    const feature = await this.prisma.feature.create({
      data: { moduleId, name: task.name, description },
    });

    await this.prisma.featurePluginBinding.create({
      data: {
        featureId: feature.id,
        installId,
        bindingConfig: { targetMode: 'subtask', defaultParentTaskId: task.id } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.prisma.ticketLink.create({
      data: {
        orgId,
        installId,
        featureId: feature.id,
        externalId: task.id,
        externalUrl: `https://app.clickup.com/t/${task.id}`,
        externalTitle: task.name,
        externalStatus: task.status,
      },
    });

    return { id: feature.id };
  }

  private async createTestForSubtask(
    projectId: string,
    featureId: string,
    sub: ClickUpListedTask,
    baseTags: string[],
    tagPrefix: string,
  ): Promise<boolean> {
    const idempotencyTag = `${tagPrefix}:${sub.id}`;
    const existing = await this.prisma.testDefinition.findFirst({
      where: { projectId, featureId, deletedAt: null, tags: { has: idempotencyTag } },
      select: { id: true },
    });
    if (existing) return false;

    await this.prisma.testDefinition.create({
      data: {
        projectId,
        featureId,
        name: sub.name,
        type: 'UI',
        steps: [] as unknown as Prisma.InputJsonValue,
        tags: [...baseTags, idempotencyTag],
        isAiDraft: false,
      },
    });
    return true;
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export type BootstrapDepth = 'module' | 'feature' | 'test';

export type BootstrapScope = {
  spaceId?: string;
  folderId?: string;
  listIds?: string[];
};

export type PreviewArgs = {
  projectId: string;
  scope: BootstrapScope;
  depth: BootstrapDepth;
};

export type RunArgs = PreviewArgs & {
  tagPrefix?: string;
};

type ClickUpListSummary = { id: string; name: string; taskCount: number };
type ClickUpListedTask = { id: string; name: string; status: string };

export type SampleFeatureBlock = {
  taskId: string;
  taskName: string;
  tests: Array<{ id: string; name: string }>;
  moreTests: number;
};

export type SampleListBlock = {
  listId: string;
  listName: string;
  moduleAlreadyExists: boolean;
  topTasksCount: number;
  testsCount: number;
  sampleFeatures: SampleFeatureBlock[];
};

export type PreviewResult = {
  lists: Array<{ id: string; name: string; alreadyImported: boolean }>;
  totals: {
    modules: number;
    features: number;
    tests: number;
    skipped: { modules: number; features: number; tests: number };
  };
  samples: SampleListBlock[];
};

export type RunResult = {
  created: { modules: number; features: number; tests: number };
  skipped: { modules: number; features: number; tests: number };
  errors: Array<{ scope: string; externalId: string; message: string }>;
};
