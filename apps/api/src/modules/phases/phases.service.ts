import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PhaseRole, PhaseStatus, Prisma } from '@prisma/client';

/**
 * Phases — the spine of the testing pipeline.
 *
 * Each Project has an ordered list of `ProjectPhase` rows ("QA Testing",
 * "UAT", "Sign-off"). Each Phase can be linked to an Environment so testers
 * in that phase know which env to point at. Each Phase has Assignments
 * (TESTER / MANAGER / VIEWER).
 *
 * Each Feature has one `FeaturePhase` row per phase, tracking where the
 * feature is in the pipeline. The lifecycle:
 *
 *   PENDING ──start()──▶ IN_PROGRESS ──complete()──▶ PASSED
 *                              │
 *                              ├──block()─────▶ BLOCKED
 *                              └──fail()──────▶ FAILED
 *
 *   PASSED ──promote()──▶ creates next phase's FeaturePhase IN_PROGRESS
 *
 * The promote() here is the *phase* promotion (separate from the env-based
 * FeatureRun.promote we built in R3). They compose: typically a phase is
 * tied to an env, so phase promotion implies env handover.
 */
@Injectable()
export class PhasesService {
  private readonly logger = new Logger(PhasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Project-level phases ──────────────────────────────────────────────

  async listForProject(projectId: string) {
    return this.prisma.projectPhase.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      include: {
        environment: { select: { id: true, name: true, type: true } },
        assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
        _count: { select: { featurePhases: true } },
      },
    });
  }

  async create(projectId: string, dto: {
    name: string; description?: string; order?: number; color?: string;
    autoPromote?: boolean; environmentId?: string; handoverRecipients?: string[];
  }) {
    // Auto-pick next order if not provided so admins don't have to count.
    let order = dto.order;
    if (order === undefined || order === null) {
      const last = await this.prisma.projectPhase.findFirst({
        where: { projectId }, orderBy: { order: 'desc' }, select: { order: true },
      });
      order = (last?.order ?? 0) + 1;
    }
    if (dto.environmentId) {
      const env = await this.prisma.environment.findUnique({ where: { id: dto.environmentId } });
      if (!env || env.projectId !== projectId) {
        throw new BadRequestException('environmentId does not belong to this project');
      }
    }
    return this.prisma.projectPhase.create({
      data: {
        projectId,
        name: dto.name,
        description: dto.description,
        order,
        color: dto.color,
        autoPromote: dto.autoPromote ?? false,
        environmentId: dto.environmentId,
        handoverRecipients: dto.handoverRecipients ?? [],
      },
    });
  }

  async update(phaseId: string, dto: Partial<{
    name: string; description: string | null; order: number; color: string | null;
    autoPromote: boolean; environmentId: string | null; handoverRecipients: string[];
  }>) {
    const existing = await this.prisma.projectPhase.findUnique({ where: { id: phaseId } });
    if (!existing) throw new NotFoundException('Phase not found');
    if (dto.environmentId) {
      const env = await this.prisma.environment.findUnique({ where: { id: dto.environmentId } });
      if (!env || env.projectId !== existing.projectId) {
        throw new BadRequestException('environmentId does not belong to this project');
      }
    }
    return this.prisma.projectPhase.update({ where: { id: phaseId }, data: dto });
  }

  async remove(phaseId: string) {
    // FeaturePhase rows have @relation(... onDelete default = restrict), so we
    // need to refuse delete when features are sitting in this phase. Better
    // to surface a clear error than dump on a foreign-key violation.
    const inUse = await this.prisma.featurePhase.count({ where: { phaseId } });
    if (inUse > 0) {
      throw new BadRequestException(`Cannot delete — ${inUse} feature(s) are tracked in this phase`);
    }
    return this.prisma.projectPhase.delete({ where: { id: phaseId } });
  }

  /** Reorder phases by sending the new full id-order list. */
  async reorder(projectId: string, orderedIds: string[]) {
    const phases = await this.prisma.projectPhase.findMany({
      where: { projectId }, select: { id: true },
    });
    const valid = new Set(phases.map(p => p.id));
    if (orderedIds.length !== phases.length || !orderedIds.every(id => valid.has(id))) {
      throw new BadRequestException('orderedIds must contain every phase id of this project exactly once');
    }
    // Two-step shuffle: temporarily move all to negative orders to avoid the
    // unique [projectId, order] constraint colliding mid-update.
    await this.prisma.$transaction([
      ...orderedIds.map((id, i) => this.prisma.projectPhase.update({
        where: { id }, data: { order: -(i + 1) },
      })),
      ...orderedIds.map((id, i) => this.prisma.projectPhase.update({
        where: { id }, data: { order: i + 1 },
      })),
    ]);
    return this.listForProject(projectId);
  }

  // ─── Phase assignments ────────────────────────────────────────────────

  async assignUser(phaseId: string, dto: { userId: string; role: PhaseRole }) {
    const phase = await this.prisma.projectPhase.findUnique({ where: { id: phaseId } });
    if (!phase) throw new NotFoundException('Phase not found');
    return this.prisma.phaseAssignment.upsert({
      where: { phaseId_userId: { phaseId, userId: dto.userId } },
      update: { role: dto.role },
      create: { phaseId, userId: dto.userId, role: dto.role },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  async unassignUser(phaseId: string, userId: string) {
    return this.prisma.phaseAssignment.delete({
      where: { phaseId_userId: { phaseId, userId } },
    });
  }

  // ─── FeaturePhase lifecycle ───────────────────────────────────────────

  /** Auto-create FeaturePhase rows for all of a project's phases for a given
   *  feature, defaulting to PENDING. Idempotent — skips ones already created. */
  async ensureFeaturePhases(featureId: string) {
    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId },
      select: { module: { select: { projectId: true } } },
    });
    if (!feature) throw new NotFoundException('Feature not found');
    const phases = await this.prisma.projectPhase.findMany({
      where: { projectId: feature.module.projectId },
      orderBy: { order: 'asc' },
    });
    if (phases.length === 0) return [];
    const existing = await this.prisma.featurePhase.findMany({
      where: { featureId, phaseId: { in: phases.map(p => p.id) } },
      select: { phaseId: true },
    });
    const have = new Set(existing.map(x => x.phaseId));
    const toCreate = phases.filter(p => !have.has(p.id));
    if (toCreate.length > 0) {
      await this.prisma.featurePhase.createMany({
        data: toCreate.map(p => ({ featureId, phaseId: p.id, status: PhaseStatus.PENDING })),
      });
    }
    return this.listFeaturePhases(featureId);
  }

  async listFeaturePhases(featureId: string) {
    return this.prisma.featurePhase.findMany({
      where: { featureId },
      include: {
        phase: { include: { environment: { select: { id: true, name: true, type: true } } } },
        promotedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { phase: { order: 'asc' } },
    });
  }

  async start(featurePhaseId: string) {
    const fp = await this.prisma.featurePhase.findUnique({ where: { id: featurePhaseId } });
    if (!fp) throw new NotFoundException('FeaturePhase not found');
    if (fp.status !== PhaseStatus.PENDING) {
      throw new BadRequestException(`Cannot start a phase in status ${fp.status}`);
    }
    return this.prisma.featurePhase.update({
      where: { id: featurePhaseId },
      data: { status: PhaseStatus.IN_PROGRESS, startedAt: new Date() },
    });
  }

  async setStatus(featurePhaseId: string, status: PhaseStatus, notes?: string) {
    const fp = await this.prisma.featurePhase.findUnique({ where: { id: featurePhaseId } });
    if (!fp) throw new NotFoundException('FeaturePhase not found');
    const data: Prisma.FeaturePhaseUpdateInput = { status, notes: notes ?? fp.notes };
    if (status === PhaseStatus.PASSED || status === PhaseStatus.FAILED) {
      data.completedAt = new Date();
    }
    return this.prisma.featurePhase.update({ where: { id: featurePhaseId }, data });
  }

  /**
   * Promote a feature OUT of the current phase and INTO the next ordered
   * phase for its project. Marks current phase PASSED, sets promotedAt /
   * promotedBy, and moves the next phase to IN_PROGRESS (creating the
   * FeaturePhase row if missing).
   */
  async promoteFeaturePhase(featurePhaseId: string, userId: string, notes?: string) {
    const fp = await this.prisma.featurePhase.findUnique({
      where: { id: featurePhaseId },
      include: { phase: true, feature: { include: { module: { select: { projectId: true } } } } },
    });
    if (!fp) throw new NotFoundException('FeaturePhase not found');
    if (fp.status !== PhaseStatus.PASSED && fp.status !== PhaseStatus.IN_PROGRESS) {
      throw new BadRequestException(`Cannot promote from status ${fp.status}`);
    }
    const next = await this.prisma.projectPhase.findFirst({
      where: { projectId: fp.feature.module.projectId, order: { gt: fp.phase.order } },
      orderBy: { order: 'asc' },
    });
    if (!next) throw new BadRequestException('No phase after this one — feature has reached the final phase');

    const now = new Date();
    // Pre-resolve handover context so the email send is the *last* thing we
    // do — if it fails (e.g. SMTP outage) the phase still promotes cleanly.
    const nextPhaseFull = await this.prisma.projectPhase.findUnique({
      where: { id: next.id },
      include: {
        environment: true,
        assignments: {
          where: { role: { in: [PhaseRole.MANAGER, PhaseRole.TESTER] } },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    const recipients = new Set<string>();
    nextPhaseFull?.handoverRecipients.forEach(e => recipients.add(e));
    nextPhaseFull?.assignments.forEach(a => a.user.email && recipients.add(a.user.email));
    const recipientList = [...recipients];

    const [promoted, nextFp] = await this.prisma.$transaction([
      this.prisma.featurePhase.update({
        where: { id: featurePhaseId },
        data: {
          status: PhaseStatus.PASSED,
          completedAt: fp.completedAt ?? now,
          promotedAt: now,
          promotedById: userId,
          notes: notes ?? fp.notes,
          handoverSentTo: recipientList,
          handoverSentAt: recipientList.length > 0 ? now : null,
        },
      }),
      this.prisma.featurePhase.upsert({
        where: { featureId_phaseId: { featureId: fp.featureId, phaseId: next.id } },
        update: { status: PhaseStatus.IN_PROGRESS, startedAt: now, completedAt: null },
        create: { featureId: fp.featureId, phaseId: next.id, status: PhaseStatus.IN_PROGRESS, startedAt: now },
      }),
    ]);

    // Best-effort handover notification. Two channels:
    //   1. In-app notifications for assigned users (real-time bell).
    //   2. Email log for everyone else (we don't have SMTP wired yet, so
    //      log to stdout — recipientList is still persisted on the row for
    //      audit; replace this with a real send when notifications module
    //      grows mail support).
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: fp.feature.module.projectId },
        select: { id: true, name: true, orgId: true },
      });
      if (project) {
        const feature = await this.prisma.feature.findUnique({
          where: { id: fp.featureId }, select: { name: true },
        });
        for (const assignment of nextPhaseFull?.assignments ?? []) {
          await this.notifications.create({
            userId: assignment.user.id,
            orgId: project.orgId,
            type: 'FEATURE_PROMOTED' as never,
            category: 'INFO' as never,
            title: `Handover: ${feature?.name ?? 'feature'} promoted to ${next.name}`,
            body: `${feature?.name ?? 'A feature'} has been promoted to the ${next.name} phase. Notes: ${notes ?? '—'}`,
            actionUrl: `/projects/${project.id}/features/${fp.featureId}`,
            actionLabel: 'Open feature',
          } as never).catch(() => {});
        }
        if (recipientList.length > 0) {
          this.logger.log(`[handover] ${feature?.name} → ${next.name}: emailing ${recipientList.join(', ')}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Handover notification failed: ${(err as Error)?.message ?? err}`);
    }

    return { promoted, nextFeaturePhase: nextFp, nextPhase: next, notifiedRecipients: recipientList };
  }

  // ─── Terminal sign-off (FeatureSignOff) ───────────────────────────────

  /**
   * Records a manager's terminal sign-off on a feature. Fired when the
   * feature has cleared all phases (typically the final "Sign-off" phase
   * is the gate). Idempotent per feature — one sign-off row per feature.
   */
  async signOffFeature(featureId: string, userId: string, message?: string) {
    const existing = await this.prisma.featureSignOff.findUnique({ where: { featureId } });
    if (existing) {
      throw new ConflictException('Feature is already signed off');
    }
    // Sanity check: every FeaturePhase must be PASSED or SKIPPED before
    // terminal sign-off. Prevents premature approval.
    const phases = await this.prisma.featurePhase.findMany({ where: { featureId }, select: { status: true } });
    const blockers = phases.filter(p => p.status !== PhaseStatus.PASSED && p.status !== PhaseStatus.SKIPPED);
    if (blockers.length > 0) {
      throw new BadRequestException(`Cannot sign off — ${blockers.length} phase(s) still pending/in-progress/blocked`);
    }
    return this.prisma.featureSignOff.create({
      data: { featureId, signedOffById: userId, message: message ?? null },
      include: { signedOffBy: { select: { id: true, name: true, email: true } } },
    });
  }

  async getFeatureSignOff(featureId: string) {
    return this.prisma.featureSignOff.findUnique({
      where: { featureId },
      include: { signedOffBy: { select: { id: true, name: true, email: true } } },
    });
  }
}
