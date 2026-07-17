import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Either the root client or a transaction client. The accept path re-derives
 * the scope and slug INSIDE its transaction, so these helpers must be able to
 * run on `tx` — reading through the root client mid-transaction would see
 * pre-transaction state and could sever the wrong rows.
 */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * A project does not live alone in its org. Moving `projects.orgId` on its own
 * would leave three kinds of wreckage behind, so every transfer is planned
 * before it is executed:
 *
 *   Class A — org-scoped content that MUST follow the project. `Doc` rows carry
 *     their own `orgId` alongside the project/module/feature/test they document.
 *     Leave them and the target org cannot read its own project's docs while the
 *     source org still can.
 *
 *   Class B — bindings to rows the SOURCE org owns, which cannot follow. Plugin
 *     bindings point at an `OrgPluginInstall`; repos point at an
 *     `OrgGitCredential`. Those belong to the source org and stay there, so the
 *     bindings must be severed rather than moved — otherwise the target org
 *     inherits live use of the source org's ClickUp/Jira install and git tokens.
 *
 *   Class C — membership. `ProjectMember` has no `orgId` of its own, so members
 *     who are not in the target org would silently keep project access across an
 *     org boundary. They are purged, and the owner is reassigned if they are one
 *     of them (`projects.ownerId` is non-nullable).
 *
 * The plan is computed twice: once when the request is raised (snapshotted onto
 * the request so the reviewing admin sees what they are accepting) and once
 * inside the accept transaction, because the project can drift in between.
 */

export interface TransferPlanMember {
  userId: string;
  name: string | null;
  email: string;
  role: string;
}

export interface TransferPlanSeverance {
  kind: string;
  label: string;
  count: number;
}

export interface TransferPlan {
  projectId: string;
  projectName: string;
  fromOrgId: string;
  toOrgId: string;
  toOrgName: string;
  slug: string;
  /** True when the target org already has a project on this slug (`@@unique([orgId, slug])`). */
  slugConflict: boolean;
  /** The slug the project will actually land on — equals `slug` when there is no conflict. */
  suggestedSlug: string;
  /** Project members who are not in the target org and will lose access. */
  membersToPurge: TransferPlanMember[];
  /** True when the current owner is among `membersToPurge` and a new owner must be picked. */
  ownerNeedsReassign: boolean;
  currentOwner: TransferPlanMember | null;
  /** Docs (project/module/feature/test scoped) that will be re-pointed at the target org. */
  docsToMove: number;
  bindingsToSever: TransferPlanSeverance[];
  totalToSever: number;
}

/** The ids that make up a project's content tree, used to scope every sweep. */
export interface ProjectScope {
  moduleIds: string[];
  featureIds: string[];
  testIds: string[];
  issueIds: string[];
}

@Injectable()
export class TransferPlanService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Collect the ids under a project. Docs, links and bindings attach at any
   * level of the tree, not just to the project row, so a sweep that only
   * matched `projectId` would miss anything hung off a module or feature.
   */
  async scopeOf(projectId: string, db: Db = this.prisma): Promise<ProjectScope> {
    const modules = await db.module.findMany({
      where: { projectId },
      select: { id: true },
    });
    const moduleIds = modules.map((m) => m.id);

    const features = moduleIds.length
      ? await db.feature.findMany({
          where: { moduleId: { in: moduleIds } },
          select: { id: true },
        })
      : [];
    const featureIds = features.map((f) => f.id);

    const [tests, issues] = await Promise.all([
      db.testDefinition.findMany({ where: { projectId }, select: { id: true } }),
      db.issue.findMany({ where: { projectId }, select: { id: true } }),
    ]);

    return {
      moduleIds,
      featureIds,
      testIds: tests.map((t) => t.id),
      issueIds: issues.map((i) => i.id),
    };
  }

  /**
   * Find a free slug in the target org. The `@@unique([orgId, slug])` index
   * covers soft-deleted projects too, so an archived project in the target org
   * still blocks the slug — the probe deliberately does not filter `deletedAt`.
   */
  async resolveSlug(
    toOrgId: string,
    slug: string,
    excludeProjectId?: string,
    db: Db = this.prisma,
  ): Promise<string> {
    for (let n = 1; n < 200; n++) {
      const candidate = n === 1 ? slug : `${slug}-${n}`;
      const taken = await db.project.findFirst({
        where: {
          orgId: toOrgId,
          slug: candidate,
          ...(excludeProjectId ? { id: { not: excludeProjectId } } : {}),
        },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    // 200 collisions on one slug is not a real scenario; failing loudly beats
    // returning a slug that will blow up on the unique index inside the tx.
    throw new BadRequestException(`Could not find a free slug for "${slug}" in the target organisation`);
  }

  async build(projectId: string, toOrgId: string): Promise<TransferPlan> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        slug: true,
        orgId: true,
        ownerId: true,
        owner: { select: { id: true, name: true, email: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.orgId) {
      throw new BadRequestException('This project does not belong to an organisation and cannot be transferred');
    }
    if (project.orgId === toOrgId) {
      throw new BadRequestException('This project is already in that organisation');
    }

    const toOrg = await this.prisma.organisation.findUnique({
      where: { id: toOrgId },
      select: { id: true, name: true },
    });
    if (!toOrg) throw new NotFoundException('Target organisation not found');

    const scope = await this.scopeOf(projectId);

    // ── Slug ────────────────────────────────────────────────────────────────
    const suggestedSlug = await this.resolveSlug(toOrgId, project.slug, projectId);
    const slugConflict = suggestedSlug !== project.slug;

    // ── Class C: membership ─────────────────────────────────────────────────
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      select: {
        userId: true,
        role: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    const targetOrgUserIds = new Set(
      (
        await this.prisma.orgMember.findMany({
          where: {
            orgId: toOrgId,
            userId: { in: [...members.map((m) => m.userId), project.ownerId] },
          },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );

    const membersToPurge: TransferPlanMember[] = members
      .filter((m) => !targetOrgUserIds.has(m.userId))
      .map((m) => ({
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
      }));

    const ownerNeedsReassign = !targetOrgUserIds.has(project.ownerId);

    // ── Class A: docs that follow ───────────────────────────────────────────
    const docsToMove = await this.prisma.doc.count({
      where: { orgId: project.orgId, ...this.treeFilter(projectId, scope) },
    });

    // ── Class B: bindings that cannot follow ────────────────────────────────
    const [
      pluginBindings,
      modulePluginBindings,
      featurePluginBindings,
      ticketLinks,
      docLinks,
      acSourceLinks,
      repos,
    ] = await Promise.all([
      this.prisma.projectPluginBinding.count({ where: { projectId, deletedAt: null } }),
      scope.moduleIds.length
        ? this.prisma.modulePluginBinding.count({
            where: { moduleId: { in: scope.moduleIds }, deletedAt: null },
          })
        : Promise.resolve(0),
      scope.featureIds.length
        ? this.prisma.featurePluginBinding.count({
            where: { featureId: { in: scope.featureIds }, deletedAt: null },
          })
        : Promise.resolve(0),
      this.prisma.ticketLink.count({
        where: { deletedAt: null, ...this.ticketFilter(projectId, scope) },
      }),
      this.prisma.docLink.count({
        where: { deletedAt: null, ...this.treeFilter(projectId, scope) },
      }),
      scope.testIds.length
        ? this.prisma.testAcSourceLink.count({ where: { testId: { in: scope.testIds } } })
        : Promise.resolve(0),
      this.prisma.projectRepo.count({ where: { projectId, deletedAt: null } }),
    ]);

    const bindingsToSever: TransferPlanSeverance[] = [
      { kind: 'projectPluginBinding', label: 'Project plugin bindings', count: pluginBindings },
      { kind: 'modulePluginBinding', label: 'Module plugin bindings', count: modulePluginBindings },
      { kind: 'featurePluginBinding', label: 'Feature plugin bindings', count: featurePluginBindings },
      { kind: 'ticketLink', label: 'Linked tickets', count: ticketLinks },
      { kind: 'docLink', label: 'Linked external docs', count: docLinks },
      { kind: 'testAcSourceLink', label: 'Test acceptance-criteria sources', count: acSourceLinks },
      { kind: 'projectRepo', label: 'Connected repositories', count: repos },
    ].filter((b) => b.count > 0);

    return {
      projectId,
      projectName: project.name,
      fromOrgId: project.orgId,
      toOrgId,
      toOrgName: toOrg.name,
      slug: project.slug,
      slugConflict,
      suggestedSlug,
      membersToPurge,
      ownerNeedsReassign,
      currentOwner: project.owner
        ? {
            userId: project.owner.id,
            name: project.owner.name,
            email: project.owner.email,
            role: 'OWNER',
          }
        : null,
      docsToMove,
      bindingsToSever,
      totalToSever: bindingsToSever.reduce((sum, b) => sum + b.count, 0),
    };
  }

  /** Matches rows attached anywhere in the project's tree (Doc, DocLink shape). */
  treeFilter(projectId: string, scope: ProjectScope) {
    return {
      OR: [
        { projectId },
        ...(scope.moduleIds.length ? [{ moduleId: { in: scope.moduleIds } }] : []),
        ...(scope.featureIds.length ? [{ featureId: { in: scope.featureIds } }] : []),
        ...(scope.testIds.length ? [{ testDefinitionId: { in: scope.testIds } }] : []),
      ],
    };
  }

  /** TicketLink hangs off issues as well as the project/module/feature tree. */
  ticketFilter(projectId: string, scope: ProjectScope) {
    return {
      OR: [
        { projectId },
        ...(scope.moduleIds.length ? [{ moduleId: { in: scope.moduleIds } }] : []),
        ...(scope.featureIds.length ? [{ featureId: { in: scope.featureIds } }] : []),
        ...(scope.issueIds.length ? [{ issueId: { in: scope.issueIds } }] : []),
      ],
    };
  }
}
