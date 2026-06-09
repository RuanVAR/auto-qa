import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  SignoffStatus, SignoffEventType, SignoffDecision,
  NotificationType, NotificationCategory, Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { StorageProvider, createStorageProvider } from '@qa-platform/storage';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvAccessService } from '../../common/access/env-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../../email/email.service';
import { StatsService } from '../stats/stats.service';
import { QueueService } from '../queue/queue.service';
import { UploadsService } from '../uploads/uploads.service';
import { webUrl } from '../../common/config/urls';
import { appName } from '../../common/config/app';
import { accessCtx } from '../../common/access/access-context';

export interface JwtRoleHint {
  sub: string;
  orgRole?: string | null;
  platformRole?: string | null;
  activeOrgId?: string | null;
}

export interface SubmitApprovalDto {
  decision: 'APPROVED' | 'REJECTED';
  typedName: string;
  drawnSignature?: string;
  note?: string;
}

export interface ModuleSignoffDto {
  typedName: string;
  drawnSignature?: string;
  note?: string;
}

/** UI-facing cell state (richer than the stored SignoffStatus). */
type CellState = 'NOT_READY' | 'ELIGIBLE' | 'AWAITING' | 'SIGNED' | 'REJECTED';

@Injectable()
export class SignoffService {
  private readonly logger = new Logger(SignoffService.name);

  // Same storage backend the report-pdf worker writes to (ARTIFACT_STORAGE_PATH).
  private readonly storage: StorageProvider = createStorageProvider(process.env, {
    localBasePath: process.env.ARTIFACT_STORAGE_PATH ?? './artifacts',
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly envAccess: EnvAccessService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly stats: StatsService,
    private readonly queue: QueueService,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * Resolve a logo URL for embedding in the certificate. Uploaded logos are
   * base64-inlined (the worker's headless browser can't fetch our upload URLs
   * reliably); data: URLs pass through; anything else is returned as-is.
   */
  private async resolveLogoSrc(logoUrl: string | null): Promise<string | null> {
    if (!logoUrl) return null;
    if (logoUrl.startsWith('data:')) return logoUrl;
    const m = logoUrl.match(/\/uploads\/([^/?#]+)/);
    if (m) return (await this.uploads.getDataUrl(m[1])) ?? null;
    return logoUrl;
  }

  /**
   * Render certificate HTML to a real PDF via the worker's report-pdf queue
   * (the API has no headless browser), then read the PDF back from storage.
   * Returns null on timeout so the caller can fall back to the HTML attachment.
   */
  private async renderCertPdf(projectId: string, html: string): Promise<Buffer | null> {
    const reportId = `signoff-${randomUUID()}`;
    const key = `reports/${projectId}/${reportId}.pdf`;
    await this.queue.enqueueReportPdf({ reportId, projectId, html, skipDbUpdate: true });
    for (let i = 0; i < 60; i++) {
      if (await this.storage.exists(key).catch(() => false)) {
        try {
          const stream = await this.storage.stream(key);
          const chunks: Buffer[] = [];
          for await (const c of stream) chunks.push(Buffer.from(c));
          return Buffer.concat(chunks);
        } catch { return null; }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private roleCtx(user: JwtRoleHint) {
    return accessCtx(user);
  }

  private async projectIdForFeature(featureId: string): Promise<string> {
    const f = await this.prisma.feature.findUnique({
      where: { id: featureId },
      select: { module: { select: { projectId: true } } },
    });
    if (!f) throw new NotFoundException('Feature not found');
    return f.module.projectId;
  }

  private async canManage(userId: string, projectId: string, user: JwtRoleHint): Promise<boolean> {
    try {
      await this.envAccess.assertSignoffManagerAccess(userId, projectId, this.roleCtx(user));
      return true;
    } catch {
      return false;
    }
  }

  /** User IDs that must sign a (project, env) cell — env-specific + project-wide. */
  private async requiredApproverIds(projectId: string, envId: string): Promise<string[]> {
    const rows = await this.prisma.signoffApprover.findMany({
      where: { projectId, OR: [{ environmentId: envId }, { environmentId: null }] },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  private deriveStatus(
    requiredIds: string[],
    approvals: { signedById: string; decision: SignoffDecision }[],
  ): SignoffStatus {
    if (approvals.some((a) => a.decision === SignoffDecision.REJECTED)) return SignoffStatus.REJECTED;
    if (requiredIds.length > 0 && requiredIds.every((id) =>
      approvals.some((a) => a.signedById === id && a.decision === SignoffDecision.APPROVED))) {
      return SignoffStatus.SIGNED;
    }
    return SignoffStatus.AWAITING;
  }

  private async event(
    projectId: string,
    type: SignoffEventType,
    data: { featureId?: string; moduleId?: string; environmentId?: string; actorId?: string; detail?: Prisma.InputJsonValue },
  ): Promise<void> {
    await this.prisma.signoffEvent.create({
      data: {
        projectId, type,
        featureId: data.featureId ?? null,
        moduleId: data.moduleId ?? null,
        environmentId: data.environmentId ?? null,
        actorId: data.actorId ?? null,
        detail: data.detail ?? Prisma.JsonNull,
      },
    });
  }

  // ── config (approvers) ───────────────────────────────────────────────────────

  async getConfig(projectId: string, user: JwtRoleHint) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, this.roleCtx(user));
    const approvers = await this.prisma.signoffApprover.findMany({
      where: { projectId },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    });
    return {
      approvers: approvers.map((a) => ({
        id: a.id, environmentId: a.environmentId, user: a.user,
      })),
      canManage: await this.canManage(user.sub, projectId, user),
    };
  }

  async setConfig(projectId: string, user: JwtRoleHint, dto: { approvers: { environmentId: string | null; userId: string }[] }) {
    await this.envAccess.assertSignoffManagerAccess(user.sub, projectId, this.roleCtx(user));
    const wanted = dto.approvers ?? [];
    await this.prisma.$transaction(async (tx) => {
      await tx.signoffApprover.deleteMany({ where: { projectId } });
      if (wanted.length) {
        await tx.signoffApprover.createMany({
          data: wanted.map((a) => ({ projectId, environmentId: a.environmentId, userId: a.userId })),
          skipDuplicates: true,
        });
      }
    });
    await this.event(projectId, SignoffEventType.CONFIG_CHANGED, { actorId: user.sub, detail: { count: wanted.length } });
    return this.getConfig(projectId, user);
  }

  // ── overview (the matrix) ─────────────────────────────────────────────────────

  async getProjectOverview(projectId: string, user: JwtRoleHint, includeArchived = false) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, this.roleCtx(user));

    const [project, envs, modules, approvers, cells, moduleCells] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } }),
      this.prisma.environment.findMany({
        where: { projectId, deletedAt: null }, orderBy: { order: 'asc' },
        select: { id: true, name: true, type: true, order: true },
      }),
      this.prisma.module.findMany({
        where: { projectId, ...(includeArchived ? {} : { deletedAt: null }) }, orderBy: { order: 'asc' },
        select: { id: true, name: true, order: true, deletedAt: true, isActive: true, features: {
          where: includeArchived ? {} : { deletedAt: null, isActive: true }, orderBy: { order: 'asc' },
          select: { id: true, name: true, order: true, deletedAt: true, isActive: true },
        } },
      }),
      this.prisma.signoffApprover.findMany({ where: { projectId }, select: { environmentId: true, userId: true } }),
      this.prisma.featureEnvSignoff.findMany({
        where: { environmentId: { in: undefined }, feature: { module: { projectId } } },
        select: { id: true, featureId: true, environmentId: true, status: true, completedAt: true,
          approvals: { select: { signedById: true, decision: true } } },
      }),
      this.prisma.moduleEnvSignoff.findMany({
        where: { module: { projectId } },
        select: { moduleId: true, environmentId: true, status: true, signedAt: true },
      }),
    ]);
    if (!project) throw new NotFoundException('Project not found');

    const requiredByEnv = new Map<string, Set<string>>();
    for (const e of envs) requiredByEnv.set(e.id, new Set());
    for (const a of approvers) {
      for (const e of envs) {
        if (a.environmentId === null || a.environmentId === e.id) requiredByEnv.get(e.id)!.add(a.userId);
      }
    }

    const cellByKey = new Map(cells.map((c) => [`${c.featureId}:${c.environmentId}`, c]));
    const moduleByKey = new Map(moduleCells.map((m) => [`${m.moduleId}:${m.environmentId}`, m]));

    // For cells with no row, compute eligibility (100% passed) lazily, in parallel.
    const needStats: { featureId: string; envId: string }[] = [];
    for (const m of modules) for (const f of m.features) for (const e of envs) {
      if (!cellByKey.has(`${f.id}:${e.id}`)) needStats.push({ featureId: f.id, envId: e.id });
    }
    const eligible = new Set<string>();
    await Promise.all(needStats.map(async ({ featureId, envId }) => {
      try {
        const s = await this.stats.computeFeatureStats(featureId, envId);
        if (s.total > 0 && s.passRate === 100) eligible.add(`${featureId}:${envId}`);
      } catch { /* ignore */ }
    }));

    let totalCells = 0, signedCells = 0;
    const perEnv = new Map(envs.map((e) => [e.id, { signed: 0, total: 0 }]));

    const moduleOut = modules.map((m) => {
      const mArchived = m.deletedAt !== null || !m.isActive;
      const features = m.features.map((f) => {
        const fArchived = mArchived || f.deletedAt !== null || !f.isActive;
        const cellsOut: Record<string, { state: CellState; signed: number; required: number; completedAt: Date | null }> = {};
        for (const e of envs) {
          const required = requiredByEnv.get(e.id)!.size;
          const row = cellByKey.get(`${f.id}:${e.id}`);
          let state: CellState;
          let signed = 0;
          if (row) {
            signed = row.approvals.filter((a) => a.decision === SignoffDecision.APPROVED).length;
            state = row.status === SignoffStatus.SIGNED ? 'SIGNED'
              : row.status === SignoffStatus.REJECTED ? 'REJECTED' : 'AWAITING';
          } else {
            state = eligible.has(`${f.id}:${e.id}`) ? 'ELIGIBLE' : 'NOT_READY';
          }
          cellsOut[e.id] = { state, signed, required, completedAt: row?.completedAt ?? null };
          // Archived features don't count toward live progress.
          if (!fArchived) {
            totalCells++; perEnv.get(e.id)!.total++;
            if (state === 'SIGNED') { signedCells++; perEnv.get(e.id)!.signed++; }
          }
        }
        return { id: f.id, name: f.name, cells: cellsOut, archived: fArchived };
      });

      // module rollup per env
      const rollup: Record<string, { state: 'NONE' | 'ELIGIBLE' | 'SIGNED'; signedAt: Date | null }> = {};
      for (const e of envs) {
        const mod = moduleByKey.get(`${m.id}:${e.id}`);
        if (mod && mod.status === SignoffStatus.SIGNED) { rollup[e.id] = { state: 'SIGNED', signedAt: mod.signedAt }; continue; }
        const allSigned = m.features.length > 0 && m.features.every((f) =>
          cellByKey.get(`${f.id}:${e.id}`)?.status === SignoffStatus.SIGNED);
        rollup[e.id] = { state: allSigned ? 'ELIGIBLE' : 'NONE', signedAt: null };
      }
      return { id: m.id, name: m.name, features, rollup, archived: mArchived };
    });

    const myRequiredEnvs = envs.filter((e) => requiredByEnv.get(e.id)!.has(user.sub)).map((e) => e.id);
    let myPending = 0;
    for (const c of cells) {
      if (c.status === SignoffStatus.AWAITING && myRequiredEnvs.includes(c.environmentId)
        && !c.approvals.some((a) => a.signedById === user.sub)) myPending++;
    }

    return {
      project: { id: project.id, name: project.name },
      environments: envs,
      progress: {
        totalCells, signedCells,
        perEnv: envs.map((e) => ({ environmentId: e.id, name: e.name, ...perEnv.get(e.id)! })),
      },
      modules: moduleOut,
      myPendingCount: myPending,
      isApprover: myRequiredEnvs.length > 0,
      canManage: await this.canManage(user.sub, projectId, user),
    };
  }

  // ── cell detail ───────────────────────────────────────────────────────────────

  async getCellDetail(featureId: string, envId: string, user: JwtRoleHint) {
    const projectId = await this.projectIdForFeature(featureId);
    await this.envAccess.assertProjectAccess(user.sub, projectId, this.roleCtx(user));

    const [feature, env, cell, requiredIds, stats] = await Promise.all([
      this.prisma.feature.findUnique({ where: { id: featureId }, select: { id: true, name: true, module: { select: { id: true, name: true } } } }),
      this.prisma.environment.findUnique({ where: { id: envId }, select: { id: true, name: true, type: true } }),
      this.prisma.featureEnvSignoff.findUnique({
        where: { featureId_environmentId: { featureId, environmentId: envId } },
        include: { approvals: { include: { signedBy: { select: { id: true, name: true, email: true, avatarUrl: true } } }, orderBy: { signedAt: 'asc' } } },
      }),
      this.requiredApproverIds(projectId, envId),
      this.stats.computeFeatureStats(featureId, envId).catch(() => null),
    ]);
    if (!feature || !env) throw new NotFoundException('Feature or environment not found');

    const approvalByUser = new Map((cell?.approvals ?? []).map((a) => [a.signedById, a]));
    const requiredUsers = requiredIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: requiredIds } }, select: { id: true, name: true, email: true, avatarUrl: true } })
      : [];

    const state: CellState = cell
      ? (cell.status === SignoffStatus.SIGNED ? 'SIGNED' : cell.status === SignoffStatus.REJECTED ? 'REJECTED' : 'AWAITING')
      : (stats && stats.total > 0 && stats.passRate === 100 ? 'ELIGIBLE' : 'NOT_READY');

    return {
      feature: { id: feature.id, name: feature.name, module: feature.module },
      environment: env,
      state,
      stats,
      approvers: requiredUsers.map((u) => {
        const a = approvalByUser.get(u.id);
        return {
          user: u,
          signed: !!a,
          decision: a?.decision ?? null,
          signedAt: a?.signedAt ?? null,
          typedName: a?.typedName ?? null,
          drawnSignature: a?.drawnSignature ?? null,
          note: a?.note ?? null,
        };
      }),
      canSign: requiredIds.includes(user.sub) && (!cell || cell.status !== SignoffStatus.SIGNED) && !approvalByUser.get(user.sub),
      iAmApprover: requiredIds.includes(user.sub),
      canManage: await this.canManage(user.sub, projectId, user),
    };
  }

  // ── submit an approval ─────────────────────────────────────────────────────────

  async submitApproval(featureId: string, envId: string, user: JwtRoleHint, dto: SubmitApprovalDto) {
    const projectId = await this.projectIdForFeature(featureId);
    const requiredIds = await this.requiredApproverIds(projectId, envId);
    if (!requiredIds.includes(user.sub)) {
      throw new ForbiddenException('You are not a designated approver for this environment');
    }
    await this.envAccess.assertEnvAccess(user.sub, projectId, envId, this.roleCtx(user));

    let cell = await this.prisma.featureEnvSignoff.findUnique({
      where: { featureId_environmentId: { featureId, environmentId: envId } },
    });
    if (!cell) {
      const s = await this.stats.computeFeatureStats(featureId, envId);
      if (!(s.total > 0 && s.passRate === 100)) {
        throw new BadRequestException('Feature is not 100% passed in this environment yet');
      }
      cell = await this.prisma.featureEnvSignoff.create({ data: { featureId, environmentId: envId } });
    }
    if (cell.status === SignoffStatus.SIGNED) throw new BadRequestException('This feature is already signed off in this environment');

    const decision = dto.decision === 'REJECTED' ? SignoffDecision.REJECTED : SignoffDecision.APPROVED;
    if (!dto.typedName?.trim()) throw new BadRequestException('Typed name is required to sign');

    await this.prisma.signoffApproval.upsert({
      where: { featureEnvSignoffId_signedById: { featureEnvSignoffId: cell.id, signedById: user.sub } },
      create: { featureEnvSignoffId: cell.id, signedById: user.sub, decision, typedName: dto.typedName.trim(), drawnSignature: dto.drawnSignature ?? null, note: dto.note ?? null },
      update: { decision, typedName: dto.typedName.trim(), drawnSignature: dto.drawnSignature ?? null, note: dto.note ?? null, signedAt: new Date() },
    });

    const approvals = await this.prisma.signoffApproval.findMany({
      where: { featureEnvSignoffId: cell.id }, select: { signedById: true, decision: true },
    });
    const status = this.deriveStatus(requiredIds, approvals);
    await this.prisma.featureEnvSignoff.update({
      where: { id: cell.id },
      data: { status, completedAt: status === SignoffStatus.SIGNED ? new Date() : null },
    });
    await this.event(projectId, decision === SignoffDecision.REJECTED ? SignoffEventType.REJECTED : SignoffEventType.APPROVED,
      { featureId, environmentId: envId, actorId: user.sub });

    if (status === SignoffStatus.SIGNED) {
      this.onCellSigned(projectId, featureId, envId).catch((e) => this.logger.error(`onCellSigned: ${e?.message}`));
    }
    return this.getCellDetail(featureId, envId, user);
  }

  /**
   * Fired when a cell reaches consensus (all approvers signed). Notifies AND
   * emails the people who own the outcome — project managers (owner + OWNER/
   * TECH_LEAD/MANAGER) and ORG_ADMINs of the project's org — so they can review
   * and, once the module is complete, do the module sign-off.
   */
  private async onCellSigned(projectId: string, featureId: string, envId: string) {
    const [feature, env, project] = await Promise.all([
      this.prisma.feature.findUnique({ where: { id: featureId }, select: { name: true, moduleId: true, module: { select: { name: true } } } }),
      this.prisma.environment.findUnique({ where: { id: envId }, select: { name: true } }),
      this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true, orgId: true, ownerId: true } }),
    ]);
    if (!feature || !env || !project?.orgId) return;
    const relUrl = `/projects/${projectId}/sign-off`;
    const fullUrl = `${webUrl()}${relUrl}`;

    const [managers, orgAdmins] = await Promise.all([
      this.prisma.projectMember.findMany({ where: { projectId, role: { in: ['OWNER', 'TECH_LEAD', 'MANAGER'] } }, select: { userId: true } }),
      this.prisma.orgMember.findMany({ where: { orgId: project.orgId, role: 'ORG_ADMIN' }, select: { userId: true } }),
    ]);
    const recipientIds = [...new Set([project.ownerId, ...managers.map((m) => m.userId), ...orgAdmins.map((m) => m.userId)])];
    const users = await this.prisma.user.findMany({ where: { id: { in: recipientIds } }, select: { id: true, name: true, email: true } });

    for (const u of users) {
      await this.notifications.create({
        userId: u.id, orgId: project.orgId, type: NotificationType.FEATURE_SIGNED_OFF, category: NotificationCategory.PHASE,
        title: `Feature signed off: ${feature.name}`,
        body: `${feature.name} was signed off by all approvers in ${env.name}. Review and sign off the module when its features are complete.`,
        actionUrl: relUrl, actionLabel: 'Review sign-off',
      }).catch(() => undefined);
      await this.email.sendSignoffCompleted(u.email, {
        recipientName: u.name,
        scopeLabel: feature.name,
        environmentName: env.name,
        projectName: project.name,
        byWhom: 'all approvers',
        url: fullUrl,
      }).catch(() => undefined);
    }

    // Auto-email the branded certificate (HTML attachment) to all approvers.
    this.emailCertificate(featureId, envId, null, undefined, true)
      .catch((e) => this.logger.error(`cert auto-email: ${e?.message}`));
  }

  // ── module-level sign-off ─────────────────────────────────────────────────────

  async signOffModule(moduleId: string, envId: string, user: JwtRoleHint, dto: ModuleSignoffDto) {
    const mod = await this.prisma.module.findUnique({
      where: { id: moduleId },
      select: { id: true, name: true, projectId: true, project: { select: { orgId: true } },
        features: { where: { deletedAt: null, isActive: true }, select: { id: true } } },
    });
    if (!mod) throw new NotFoundException('Module not found');
    await this.envAccess.assertSignoffManagerAccess(user.sub, mod.projectId, this.roleCtx(user));
    if (!dto.typedName?.trim()) throw new BadRequestException('Typed name is required to sign');

    if (mod.features.length === 0) throw new BadRequestException('Module has no features to sign off');
    const signed = await this.prisma.featureEnvSignoff.count({
      where: { environmentId: envId, status: SignoffStatus.SIGNED, featureId: { in: mod.features.map((f) => f.id) } },
    });
    if (signed !== mod.features.length) {
      throw new BadRequestException('Every feature in this module must be signed off in this environment first');
    }

    const rec = await this.prisma.moduleEnvSignoff.upsert({
      where: { moduleId_environmentId: { moduleId, environmentId: envId } },
      create: { moduleId, environmentId: envId, signedById: user.sub, typedName: dto.typedName.trim(), drawnSignature: dto.drawnSignature ?? null, note: dto.note ?? null },
      update: { signedById: user.sub, typedName: dto.typedName.trim(), drawnSignature: dto.drawnSignature ?? null, note: dto.note ?? null, signedAt: new Date(), status: SignoffStatus.SIGNED },
    });
    await this.event(mod.projectId, SignoffEventType.MODULE_SIGNED, { moduleId, environmentId: envId, actorId: user.sub });

    if (mod.project.orgId) {
      const env = await this.prisma.environment.findUnique({ where: { id: envId }, select: { name: true } });
      const managers = await this.prisma.projectMember.findMany({
        where: { projectId: mod.projectId, role: { in: ['OWNER', 'TECH_LEAD', 'MANAGER'] } }, select: { userId: true },
      });
      for (const uid of [...new Set(managers.map((m) => m.userId))]) {
        await this.notifications.create({
          userId: uid, orgId: mod.project.orgId, type: NotificationType.MODULE_SIGNED_OFF, category: NotificationCategory.PHASE,
          title: `Module signed off: ${mod.name}`,
          body: `${mod.name} was officially signed off in ${env?.name ?? 'an environment'}.`,
          actionUrl: `/projects/${mod.projectId}/sign-off`, actionLabel: 'View sign-off',
        }).catch(() => undefined);
      }
    }
    return rec;
  }

  // ── history ─────────────────────────────────────────────────────────────────

  async getHistory(projectId: string, user: JwtRoleHint, limit = 200) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, this.roleCtx(user));
    const events = await this.prisma.signoffEvent.findMany({
      where: { projectId }, orderBy: { createdAt: 'desc' }, take: Math.min(limit, 500),
      include: { actor: { select: { id: true, name: true, avatarUrl: true } } },
    });
    // hydrate names for feature/module/env ids referenced
    const fids = [...new Set(events.map((e) => e.featureId).filter(Boolean) as string[])];
    const mids = [...new Set(events.map((e) => e.moduleId).filter(Boolean) as string[])];
    const eids = [...new Set(events.map((e) => e.environmentId).filter(Boolean) as string[])];
    const [features, modules, envs] = await Promise.all([
      fids.length ? this.prisma.feature.findMany({ where: { id: { in: fids } }, select: { id: true, name: true } }) : [],
      mids.length ? this.prisma.module.findMany({ where: { id: { in: mids } }, select: { id: true, name: true } }) : [],
      eids.length ? this.prisma.environment.findMany({ where: { id: { in: eids } }, select: { id: true, name: true } }) : [],
    ]);
    const fmap = new Map(features.map((f) => [f.id, f.name]));
    const mmap = new Map(modules.map((m) => [m.id, m.name]));
    const emap = new Map(envs.map((e) => [e.id, e.name]));
    return events.map((e) => ({
      id: e.id, type: e.type, createdAt: e.createdAt, actor: e.actor,
      featureName: e.featureId ? fmap.get(e.featureId) ?? null : null,
      moduleName: e.moduleId ? mmap.get(e.moduleId) ?? null : null,
      environmentName: e.environmentId ? emap.get(e.environmentId) ?? null : null,
      detail: e.detail,
    }));
  }

  // ── certificate (print-ready HTML → browser Save-as-PDF / print) ───────────────

  private esc(s: unknown): string {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  }

  /**
   * Build a self-contained, print-friendly HTML sign-off certificate for a
   * feature (env-scoped) or a whole module (env-scoped). Returns the HTML
   * string; the controller serves it as text/html so the browser can print or
   * Save-as-PDF. Writes a CERT_GENERATED audit event.
   */
  async getCertificateHtml(
    scope: 'feature' | 'module',
    scopeId: string,
    envId: string,
    user: JwtRoleHint | null,
    internal = false,
  ): Promise<string> {
    const env = await this.prisma.environment.findUnique({ where: { id: envId }, select: { id: true, name: true } });
    if (!env) throw new NotFoundException('Environment not found');

    type SigBlock = { heading: string; subheading?: string; approvals: { name: string; typedName: string; drawnSignature: string | null; decision: SignoffDecision; signedAt: Date; note: string | null }[] };
    const blocks: SigBlock[] = [];
    let projectId: string;
    let scopeName: string; // "{feature}" or "{module}" — drives the title

    if (scope === 'feature') {
      const feature = await this.prisma.feature.findUnique({
        where: { id: scopeId },
        select: { id: true, name: true, module: { select: { id: true, name: true, projectId: true, project: { select: { name: true } } } } },
      });
      if (!feature) throw new NotFoundException('Feature not found');
      projectId = feature.module.projectId;
      if (!internal && user) await this.envAccess.assertProjectAccess(user.sub, projectId, this.roleCtx(user));
      scopeName = feature.name;
      const cell = await this.prisma.featureEnvSignoff.findUnique({
        where: { featureId_environmentId: { featureId: scopeId, environmentId: envId } },
        include: { approvals: { include: { signedBy: { select: { name: true } } }, orderBy: { signedAt: 'asc' } } },
      });
      blocks.push({
        heading: `Feature: ${feature.name}`,
        subheading: `Module: ${feature.module.name}`,
        approvals: (cell?.approvals ?? []).map((a) => ({ name: a.signedBy.name, typedName: a.typedName, drawnSignature: a.drawnSignature, decision: a.decision, signedAt: a.signedAt, note: a.note })),
      });
    } else {
      const mod = await this.prisma.module.findUnique({
        where: { id: scopeId },
        select: { id: true, name: true, projectId: true, project: { select: { name: true } }, features: { where: { deletedAt: null, isActive: true }, select: { id: true, name: true } } },
      });
      if (!mod) throw new NotFoundException('Module not found');
      projectId = mod.projectId;
      if (!internal && user) await this.envAccess.assertProjectAccess(user.sub, projectId, this.roleCtx(user));
      scopeName = mod.name;
      const cells = await this.prisma.featureEnvSignoff.findMany({
        where: { environmentId: envId, featureId: { in: mod.features.map((f) => f.id) } },
        include: { approvals: { include: { signedBy: { select: { name: true } } }, orderBy: { signedAt: 'asc' } } },
      });
      const cellByFeature = new Map(cells.map((c) => [c.featureId, c]));
      for (const f of mod.features) {
        const c = cellByFeature.get(f.id);
        blocks.push({
          heading: `Feature: ${f.name}`,
          approvals: (c?.approvals ?? []).map((a) => ({ name: a.signedBy.name, typedName: a.typedName, drawnSignature: a.drawnSignature, decision: a.decision, signedAt: a.signedAt, note: a.note })),
        });
      }
      const modSig = await this.prisma.moduleEnvSignoff.findUnique({
        where: { moduleId_environmentId: { moduleId: scopeId, environmentId: envId } },
        include: { signedBy: { select: { name: true } } },
      });
      if (modSig) {
        blocks.unshift({
          heading: `Module sign-off: ${mod.name}`,
          approvals: [{ name: modSig.signedBy.name, typedName: modSig.typedName, drawnSignature: modSig.drawnSignature, decision: SignoffDecision.APPROVED, signedAt: modSig.signedAt, note: modSig.note }],
        });
      }
    }

    // Org branding for the certificate header (name, logo, accent colour).
    const proj = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, org: { select: { name: true, logoUrl: true, primaryColor: true } } },
    });
    const orgName = proj?.org?.name ?? proj?.name ?? appName();
    const logoUrl = await this.resolveLogoSrc(proj?.org?.logoUrl ?? null);
    const accent = proj?.org?.primaryColor ?? '#7c3aed';
    const docTitle = `${scope === 'feature' ? 'Feature' : 'Module'} ${scopeName} — ${env.name} Sign-off`;

    const events = await this.prisma.signoffEvent.findMany({
      where: { projectId, environmentId: envId, OR: [{ featureId: scope === 'feature' ? scopeId : undefined }, { moduleId: scope === 'module' ? scopeId : undefined }] },
      orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true } } }, take: 100,
    });
    await this.event(projectId, SignoffEventType.CERT_GENERATED, { actorId: user?.sub, featureId: scope === 'feature' ? scopeId : undefined, moduleId: scope === 'module' ? scopeId : undefined, environmentId: envId });

    const sigRows = blocks.map((b) => `
      <section class="block">
        <h3>${this.esc(b.heading)}</h3>
        ${b.subheading ? `<p class="muted">${this.esc(b.subheading)}</p>` : ''}
        ${b.approvals.length === 0 ? '<p class="muted">No signatures recorded.</p>' : `
        <table class="sigs"><thead><tr><th>Approver</th><th>Decision</th><th>Date</th><th>Signature</th></tr></thead><tbody>
          ${b.approvals.map((a) => `<tr>
            <td><strong>${this.esc(a.typedName)}</strong><br><span class="muted">${this.esc(a.name)}</span></td>
            <td class="${a.decision === 'APPROVED' ? 'ok' : 'bad'}">${a.decision === 'APPROVED' ? '✓ Approved' : '✗ Rejected'}</td>
            <td>${a.signedAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
            <td>${a.drawnSignature ? `<img class="sig" src="${this.esc(a.drawnSignature)}" alt="signature"/>` : '<span class="muted">—</span>'}</td>
          </tr>${a.note ? `<tr><td colspan="4" class="note">Note: ${this.esc(a.note)}</td></tr>` : ''}`).join('')}
        </tbody></table>`}
      </section>`).join('');

    const auditRows = events.map((e) => `<li><span class="muted">${e.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</span> — <strong>${this.esc(e.type)}</strong>${e.actor ? ` by ${this.esc(e.actor.name)}` : ''}</li>`).join('');

    return `<!doctype html><html><head><meta charset="utf-8"><title>QA Sign-off Certificate</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:0;padding:40px;max-width:880px;margin:0 auto}
  h1{font-size:26px;margin:0 0 4px} .scope{color:#475569;margin:0 0 24px}
  .meta{display:flex;gap:24px;flex-wrap:wrap;font-size:13px;color:#475569;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:12px 0;margin-bottom:24px}
  .block{margin-bottom:28px} h3{font-size:16px;margin:0 0 8px;border-left:3px solid #2563eb;padding-left:10px}
  table.sigs{width:100%;border-collapse:collapse;font-size:13px} .sigs th{text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;padding:6px 8px}
  .sigs td{padding:8px;border-bottom:1px solid #f1f5f9;vertical-align:top} .ok{color:#16a34a;font-weight:600} .bad{color:#dc2626;font-weight:600}
  img.sig{height:48px;max-width:200px;object-fit:contain;border:1px solid #e2e8f0;border-radius:4px;background:#fff}
  .note{color:#475569;font-style:italic;font-size:12px} .muted{color:#94a3b8}
  .audit{font-size:12px;color:#475569} .audit ul{margin:6px 0;padding-left:18px}
  .stamp{margin-top:32px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
  @media print{body{padding:0}.noprint{display:none}}
</style></head><body>
  ${internal ? '' : '<button class="noprint" onclick="window.print()" style="float:right;padding:8px 14px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;cursor:pointer">Print / Save PDF</button>'}
  <div style="display:flex;align-items:center;gap:12px;border-bottom:3px solid ${accent};padding-bottom:14px;margin-bottom:18px">
    ${logoUrl ? `<img src="${this.esc(logoUrl)}" alt="" style="width:42px;height:42px;object-fit:contain;border-radius:8px"/>` : ''}
    <div style="font-size:15px;font-weight:700;letter-spacing:0.3px;color:${accent}">${this.esc(orgName)}</div>
  </div>
  <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8">Sign-off Certificate</div>
  <h1 style="color:${accent}">${this.esc(docTitle)}</h1>
  <p class="scope">${this.esc(proj?.name ?? '')} · ${this.esc(env.name)}</p>
  <div class="meta"><span><strong>Environment:</strong> ${this.esc(env.name)}</span><span><strong>Generated:</strong> ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</span></div>
  ${sigRows}
  <div class="audit"><h3>Audit trail</h3><ul>${auditRows || '<li class="muted">No events.</li>'}</ul></div>
  <p class="stamp">Generated by the ${this.esc(appName())} sign-off system. This certificate reflects the recorded sign-off state at generation time.</p>
</body></html>`;
  }

  /**
   * Email the branded certificate (as an HTML attachment) for a signed-off
   * feature×env. Recipients default to all designated approvers; a caller can
   * pass an explicit list. Used by the "Email certificate" button and the
   * automatic send on consensus.
   */
  async emailCertificate(
    featureId: string,
    envId: string,
    user: JwtRoleHint | null,
    recipients?: string[],
    skipAccess = false,
  ): Promise<{ sent: number }> {
    const projectId = await this.projectIdForFeature(featureId);
    if (!skipAccess && user) await this.envAccess.assertProjectAccess(user.sub, projectId, this.roleCtx(user));

    const [feature, env] = await Promise.all([
      this.prisma.feature.findUnique({
        where: { id: featureId },
        select: { name: true, module: { select: { project: { select: { name: true, orgId: true, org: { select: { name: true, logoUrl: true } } } } } } },
      }),
      this.prisma.environment.findUnique({ where: { id: envId }, select: { name: true } }),
    ]);
    if (!feature || !env) throw new NotFoundException('Feature or environment not found');

    let to = recipients?.filter(Boolean);
    if (!to?.length) {
      const ids = await this.requiredApproverIds(projectId, envId);
      const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { email: true } }) : [];
      to = users.map((u) => u.email);
    }
    if (!to.length) throw new BadRequestException('No recipients — configure approvers or pass an explicit list');

    const certHtml = await this.getCertificateHtml('feature', featureId, envId, null, true);
    const pdf = await this.renderCertPdf(projectId, certHtml).catch(() => null);
    const attachment = pdf
      ? { filename: 'signoff-certificate.pdf', content: pdf, contentType: 'application/pdf' }
      : { filename: 'signoff-certificate.html', content: certHtml, contentType: 'text/html; charset=utf-8' };
    await this.email.sendSignoffCertificate(
      to,
      {
        scopeLabel: feature.name,
        environmentName: env.name,
        projectName: feature.module.project.name,
        byWhom: 'all approvers',
        url: `${webUrl()}/projects/${projectId}/sign-off/features/${featureId}/environments/${envId}`,
        isModule: false,
      },
      attachment,
      { name: feature.module.project.org?.name, logoUrl: feature.module.project.org?.logoUrl },
    );
    return { sent: to.length };
  }

  /**
   * Render the certificate to a PDF buffer (via the worker), for the
   * "Print / Save certificate" download. Returns null if rendering times out so
   * the caller can fall back to the HTML view.
   */
  async getCertificatePdf(scope: 'feature' | 'module', scopeId: string, envId: string, user: JwtRoleHint): Promise<Buffer | null> {
    const projectId = scope === 'feature'
      ? await this.projectIdForFeature(scopeId)
      : (await this.prisma.module.findUnique({ where: { id: scopeId }, select: { projectId: true } }))?.projectId;
    if (!projectId) throw new NotFoundException('Project not found');
    await this.envAccess.assertProjectAccess(user.sub, projectId, this.roleCtx(user));
    const html = await this.getCertificateHtml(scope, scopeId, envId, user, true); // internal: omit print button, access already checked
    return this.renderCertPdf(projectId, html);
  }

  // ── automation trigger ─────────────────────────────────────────────────────────

  /**
   * Called when a feature hits 100% passed in an environment (from
   * feature-runs onRunComplete). Creates the cell (AWAITING) + notifies and
   * emails every required approver with a link to the Feature Sign-off page.
   * Idempotent — no-op if already requested/signed.
   */
  async requestSignoff(featureId: string, envId: string): Promise<void> {
    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId },
      select: { id: true, name: true, moduleId: true, module: { select: { name: true, projectId: true, project: { select: { name: true, orgId: true } } } } },
    });
    if (!feature) return;
    const projectId = feature.module.projectId;

    // Self-guard: only trigger when the feature is genuinely 100% passed in
    // this env, so callers (onRunComplete) can fire unconditionally.
    const stats = await this.stats.computeFeatureStats(featureId, envId).catch(() => null);
    if (!stats || stats.total === 0 || stats.passRate !== 100) return;

    const existing = await this.prisma.featureEnvSignoff.findUnique({
      where: { featureId_environmentId: { featureId, environmentId: envId } },
      select: { id: true, status: true },
    });
    if (existing) return; // already requested/awaiting/signed — don't re-notify
    await this.prisma.featureEnvSignoff.create({ data: { featureId, environmentId: envId } });
    await this.event(projectId, SignoffEventType.REQUESTED, { featureId, environmentId: envId });

    const approverIds = await this.requiredApproverIds(projectId, envId);
    await this.dispatchSignoffRequests(featureId, envId, approverIds);
  }

  /**
   * Manual "send / resend sign-off request" from the Feature Sign-off page.
   * Allowed for a required approver (nudge co-approvers) or a project manager /
   * org admin (kick off / escalate). Two cases:
   *   • No request yet (cell ELIGIBLE) — verify the feature is 100% passed,
   *     create the cell, and notify ALL required approvers.
   *   • Request open (AWAITING) — re-notify only the approvers who haven't
   *     responded yet.
   */
  async resendSignoffRequest(featureId: string, envId: string, user: JwtRoleHint): Promise<{ notified: number; created: boolean }> {
    const projectId = await this.projectIdForFeature(featureId);
    const requiredIds = await this.requiredApproverIds(projectId, envId);
    const isApprover = requiredIds.includes(user.sub);
    const canManage = await this.canManage(user.sub, projectId, user);
    if (!isApprover && !canManage) {
      throw new ForbiddenException('Only a designated approver or a project manager can send the request');
    }
    if (!requiredIds.length) throw new BadRequestException('No approvers are configured for this environment');

    const cell = await this.prisma.featureEnvSignoff.findUnique({
      where: { featureId_environmentId: { featureId, environmentId: envId } },
      include: { approvals: { select: { signedById: true } } },
    });

    // Not requested yet — gate on 100% passed, create the cell, notify everyone.
    if (!cell) {
      const stats = await this.stats.computeFeatureStats(featureId, envId).catch(() => null);
      if (!stats || stats.total === 0 || stats.passRate !== 100) {
        throw new BadRequestException('Feature is not 100% passed in this environment yet');
      }
      await this.prisma.featureEnvSignoff.create({ data: { featureId, environmentId: envId } });
      const notified = await this.dispatchSignoffRequests(featureId, envId, requiredIds);
      await this.event(projectId, SignoffEventType.REQUESTED, { featureId, environmentId: envId, actorId: user.sub, detail: { manual: true, notified } });
      return { notified, created: true };
    }

    if (cell.status === SignoffStatus.SIGNED) throw new BadRequestException('This feature is already signed off');

    const signed = new Set(cell.approvals.map((a) => a.signedById));
    const pending = requiredIds.filter((id) => !signed.has(id));
    if (!pending.length) throw new BadRequestException('All approvers have already responded');

    const notified = await this.dispatchSignoffRequests(featureId, envId, pending);
    await this.event(projectId, SignoffEventType.REQUESTED, { featureId, environmentId: envId, actorId: user.sub, detail: { resend: true, notified } });
    return { notified, created: false };
  }

  /** Shared: notify + email a set of approver user IDs for a (feature, env) cell. */
  private async dispatchSignoffRequests(featureId: string, envId: string, approverIds: string[]): Promise<number> {
    if (!approverIds.length) return 0;
    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId },
      select: { name: true, module: { select: { name: true, projectId: true, project: { select: { name: true, orgId: true } } } } },
    });
    if (!feature || !feature.module.project.orgId) return 0;
    const orgId = feature.module.project.orgId;
    const projectId = feature.module.projectId;

    const [env, approvers, stats] = await Promise.all([
      this.prisma.environment.findUnique({ where: { id: envId }, select: { name: true } }),
      this.prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true, email: true } }),
      this.stats.computeFeatureStats(featureId, envId).catch(() => null),
    ]);
    if (!env) return 0;
    const pageUrl = `${webUrl()}/projects/${projectId}/sign-off/features/${featureId}/environments/${envId}`;
    const actionUrl = `/projects/${projectId}/sign-off/features/${featureId}/environments/${envId}`;
    const coNames = approvers.map((a) => a.name);

    for (const ap of approvers) {
      await this.notifications.create({
        userId: ap.id, orgId, type: NotificationType.FEATURE_SIGNOFF_REQUESTED, category: NotificationCategory.PHASE,
        title: `Sign-off needed: ${feature.name}`,
        body: `${feature.name} passed 100% in ${env.name} and needs your sign-off.`,
        actionUrl, actionLabel: 'Review & sign off',
      }).catch(() => undefined);
      await this.email.sendSignoffRequest(ap.email, {
        recipientName: ap.name,
        featureName: feature.name,
        moduleName: feature.module.name,
        environmentName: env.name,
        projectName: feature.module.project.name,
        passRate: stats?.passRate ?? 100,
        passed: stats?.passed ?? 0,
        total: stats?.total ?? 0,
        coApprovers: coNames.filter((n) => n !== ap.name),
        signoffUrl: pageUrl,
      }).catch(() => undefined);
    }
    return approvers.length;
  }
}
