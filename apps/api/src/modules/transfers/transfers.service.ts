import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { webUrl } from '../../common/config/urls';
import { TransferPlanService, TransferPlan } from './transfer-plan.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { ValidateCodeDto } from './dto/validate-code.dto';
import { ReviewTransferDto } from './dto/review-transfer.dto';

/** How long a pending transfer stays actionable before it lapses. */
const TRANSFER_TTL_DAYS = 14;

/**
 * Code alphabet, deliberately without O/0/I/1 — these codes get read aloud and
 * pasted between organisations, and a misread character is an unactionable
 * "invalid code" error with no way to self-diagnose.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plan: TransferPlanService,
    private readonly email: EmailService,
  ) {}

  // ── Org transfer codes ────────────────────────────────────────────────────

  private generateCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return out;
  }

  /** Rotate an org's transfer code. Invalidates the old code immediately. */
  async rotateCode(orgId: string): Promise<{ transferCode: string }> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const transferCode = this.generateCode();
      try {
        const org = await this.prisma.organisation.update({
          where: { id: orgId },
          data: { transferCode },
          select: { transferCode: true },
        });
        return { transferCode: org.transferCode! };
      } catch (e: unknown) {
        // P2002 = unique violation on transferCode. Astronomically unlikely at
        // 32^12, but retrying is cheaper than explaining a 500 to a user.
        if ((e as { code?: string }).code === 'P2002') continue;
        throw e;
      }
    }
    throw new ConflictException('Could not allocate a unique transfer code, please retry');
  }

  async getCode(orgId: string) {
    const org = await this.prisma.organisation.findUnique({
      where: { id: orgId },
      select: { transferCode: true, acceptsTransfers: true },
    });
    if (!org) throw new NotFoundException('Organisation not found');
    // Orgs created before this feature shipped were backfilled, but an org that
    // somehow has no code still needs one before it can receive transfers.
    if (!org.transferCode) {
      const { transferCode } = await this.rotateCode(orgId);
      return { transferCode, acceptsTransfers: org.acceptsTransfers };
    }
    return org;
  }

  async setAcceptsTransfers(orgId: string, acceptsTransfers: boolean) {
    return this.prisma.organisation.update({
      where: { id: orgId },
      data: { acceptsTransfers },
      select: { id: true, acceptsTransfers: true },
    });
  }

  /**
   * Resolve a transfer code to an org.
   *
   * This is the ONLY way a requesting admin learns that another org exists —
   * there is no org directory for them. So the response is deliberately thin:
   * the org's display name and nothing else, and only on an exact code match.
   * A wrong code returns `{ valid: false }` rather than a 404, so the endpoint
   * cannot be used to probe which codes exist by status code alone.
   */
  async validateCode(projectId: string, dto: ValidateCodeDto, requesterId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project?.orgId) throw new NotFoundException('Project not found');

    const code = dto.code.trim().toUpperCase();
    const org = await this.prisma.organisation.findUnique({
      where: { transferCode: code },
      select: { id: true, name: true, acceptsTransfers: true },
    });

    if (!org) return { valid: false as const, reason: 'UNKNOWN_CODE' as const };
    if (org.id === project.orgId) {
      return { valid: false as const, reason: 'SAME_ORG' as const };
    }
    if (!org.acceptsTransfers) {
      return { valid: false as const, reason: 'NOT_ACCEPTING' as const };
    }

    this.logger.log(
      `Transfer code resolved by user=${requesterId} project=${projectId} -> org=${org.id}`,
    );
    // Only the name — never the id. The id would let the caller address the org
    // on other endpoints it has no business touching.
    return { valid: true as const, orgName: org.name };
  }

  /**
   * Show the sending admin what a transfer to this code would do, before they
   * commit to raising a request. Resolves the code the same way `createRequest`
   * does, so the preview and the real thing cannot disagree about the target.
   */
  async previewTransfer(projectId: string, dto: ValidateCodeDto) {
    const toOrg = await this.resolveTarget(projectId, dto.code);
    const plan = await this.plan.build(projectId, toOrg.id);
    return { plan, impacts: this.impactLines(plan) };
  }

  // ── Requesting ────────────────────────────────────────────────────────────

  /**
   * Resolve a code to a usable destination org, or explain why it is not one.
   * Shared by preview and create so a code that previews clean cannot fail on
   * submit for a reason the admin never saw.
   */
  private async resolveTarget(projectId: string, rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    const toOrg = await this.prisma.organisation.findUnique({
      where: { transferCode: code },
      select: { id: true, name: true, acceptsTransfers: true },
    });
    if (!toOrg) throw new BadRequestException('That organisation code is not valid');
    if (!toOrg.acceptsTransfers) {
      throw new BadRequestException('That organisation is not currently accepting project transfers');
    }
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project?.orgId) throw new NotFoundException('Project not found');
    if (project.orgId === toOrg.id) {
      throw new BadRequestException('This project is already in that organisation');
    }
    return toOrg;
  }

  async createRequest(projectId: string, requesterId: string, dto: CreateTransferDto) {
    const toOrg = await this.resolveTarget(projectId, dto.code);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, orgId: true, deletedAt: true },
    });
    if (!project?.orgId) throw new NotFoundException('Project not found');
    if (project.deletedAt) throw new BadRequestException('Archived projects cannot be transferred');

    const existing = await this.prisma.projectTransferRequest.findFirst({
      where: { projectId, status: 'PENDING' },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('This project already has a pending transfer request');
    }

    // Snapshot the plan onto the request so the reviewing admin sees the impact
    // as it stood when raised. It is rebuilt at accept time — this copy is for
    // display and for showing drift, never for executing.
    const plan = await this.plan.build(projectId, toOrg.id);

    const expiresAt = new Date(Date.now() + TRANSFER_TTL_DAYS * 24 * 60 * 60 * 1000);

    const request = await this.prisma.projectTransferRequest.create({
      data: {
        projectId,
        fromOrgId: project.orgId,
        toOrgId: toOrg.id,
        requestedById: requesterId,
        message: dto.message,
        expiresAt,
        plan: plan as unknown as object,
        status: 'PENDING',
      },
      include: {
        project: { select: { id: true, name: true } },
        fromOrg: { select: { id: true, name: true } },
        toOrg: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await this.notifyOrgAdmins(request.toOrgId, {
      type: 'PROJECT_TRANSFER_REQUESTED',
      title: 'Incoming project transfer',
      body: `${request.fromOrg.name} wants to transfer "${request.project.name}" to your organisation.`,
      actionUrl: `/org/transfers`,
      actionLabel: 'Review transfer',
      meta: { requestId: request.id, projectId },
    });

    void this.emailTargetAdmins(request, plan);
    await this.audit('project_transfer.requested', request, requesterId);

    return request;
  }

  /** Withdraw a pending request. Only the source org can do this. */
  async cancelRequest(projectId: string, requestId: string, userId: string) {
    const request = await this.prisma.projectTransferRequest.findUnique({
      where: { id: requestId },
      include: {
        project: { select: { id: true, name: true } },
        fromOrg: { select: { id: true, name: true } },
        toOrg: { select: { id: true, name: true } },
      },
    });
    // 404 (not 403) on scope mismatch — a request under a different project is
    // not this caller's to know about.
    if (!request || request.projectId !== projectId) {
      throw new NotFoundException('Transfer request not found');
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException('This transfer request has already been resolved');
    }

    const updated = await this.prisma.projectTransferRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED', reviewedById: userId, reviewedAt: new Date() },
      include: {
        project: { select: { id: true, name: true } },
        fromOrg: { select: { id: true, name: true } },
        toOrg: { select: { id: true, name: true } },
      },
    });

    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });

    await this.notifyOrgAdmins(request.toOrgId, {
      type: 'PROJECT_TRANSFER_CANCELLED',
      title: 'Transfer withdrawn',
      body: `${request.fromOrg.name} withdrew the transfer of "${request.project.name}".`,
      actionUrl: `/org/transfers`,
      meta: { requestId: request.id },
    });

    void this.safely(async () => {
      const emails = await this.orgAdminEmails(request.toOrgId);
      if (!emails.length) return;
      await this.email.sendProjectTransferCancelled(
        emails,
        {
          projectName: request.project.name,
          fromOrgName: request.fromOrg.name,
          cancelledByName: actor?.name ?? actor?.email ?? 'An administrator',
        },
        { name: request.toOrg.name },
      );
    });

    await this.audit('project_transfer.cancelled', updated, userId);
    return updated;
  }

  // ── Reviewing ─────────────────────────────────────────────────────────────

  /** Load a request for the target org's review screen, with a fresh plan. */
  async getForReview(requestId: string, toOrgId: string) {
    const request = await this.prisma.projectTransferRequest.findUnique({
      where: { id: requestId },
      include: {
        project: { select: { id: true, name: true, slug: true, description: true } },
        fromOrg: { select: { id: true, name: true } },
        toOrg: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!request || request.toOrgId !== toOrgId) {
      throw new NotFoundException('Transfer request not found');
    }

    // Show the CURRENT impact, not the snapshot — the project may have gained
    // members or bindings since the request was raised, and the admin is
    // consenting to what happens now.
    const currentPlan =
      request.status === 'PENDING'
        ? await this.plan.build(request.projectId, request.toOrgId).catch(() => null)
        : null;

    return { ...request, currentPlan };
  }

  async reject(requestId: string, toOrgId: string, reviewerId: string, dto: ReviewTransferDto) {
    const request = await this.loadPending(requestId, toOrgId);

    const updated = await this.prisma.projectTransferRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        decisionNote: dto.note ?? null,
      },
      include: {
        project: { select: { id: true, name: true } },
        fromOrg: { select: { id: true, name: true } },
        toOrg: { select: { id: true, name: true } },
      },
    });

    const reviewer = await this.prisma.user.findUnique({
      where: { id: reviewerId },
      select: { name: true, email: true },
    });
    const reviewerName = reviewer?.name ?? reviewer?.email ?? 'An administrator';

    await this.notifyOrgAdmins(request.fromOrgId, {
      type: 'PROJECT_TRANSFER_REJECTED',
      title: 'Transfer declined',
      body: `${request.toOrg.name} declined the transfer of "${request.project.name}".`,
      actionUrl: `/projects/${request.projectId}/settings`,
      meta: { requestId },
    });

    void this.safely(async () => {
      const emails = await this.orgAdminEmails(request.fromOrgId);
      if (!emails.length) return;
      await this.email.sendProjectTransferRejected(
        emails,
        {
          projectName: request.project.name,
          toOrgName: request.toOrg.name,
          reviewerName,
          note: dto.note,
        },
        { name: request.fromOrg.name },
      );
    });

    await this.audit('project_transfer.rejected', updated, reviewerId);
    return updated;
  }

  /**
   * Accept and execute the transfer in one transaction.
   *
   * The plan is rebuilt from scratch INSIDE the transaction rather than read
   * off the snapshot: between raising and accepting, the source org can add
   * members, modules or plugin bindings, and executing a stale plan would leave
   * exactly the cross-org leaks the plan exists to prevent.
   */
  async accept(requestId: string, toOrgId: string, reviewerId: string, dto: ReviewTransferDto) {
    const request = await this.loadPending(requestId, toOrgId);

    const result = await this.prisma.$transaction(async (tx) => {
      // Re-read under the transaction — two admins can hit Accept together, and
      // the second must lose rather than run the move twice.
      const fresh = await tx.projectTransferRequest.findUnique({
        where: { id: requestId },
        select: { status: true, projectId: true, fromOrgId: true, toOrgId: true, expiresAt: true },
      });
      if (!fresh || fresh.status !== 'PENDING') {
        throw new ConflictException('This transfer request has already been resolved');
      }
      if (fresh.expiresAt.getTime() < Date.now()) {
        throw new ConflictException('This transfer request has expired');
      }

      const { projectId, fromOrgId } = fresh;
      const now = new Date();

      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { id: true, name: true, slug: true, orgId: true, ownerId: true, deletedAt: true },
      });
      if (!project) throw new NotFoundException('Project not found');
      if (project.deletedAt) throw new BadRequestException('Archived projects cannot be transferred');
      if (project.orgId !== fromOrgId) {
        // The project moved out from under this request (a second transfer, or
        // a platform admin edit). Refuse rather than yank it out of wherever it
        // now lives.
        throw new ConflictException('This project has moved since the request was raised');
      }

      const scope = await this.plan.scopeOf(projectId, tx);
      const slug = await this.plan.resolveSlug(toOrgId, project.slug, projectId, tx);

      // ── Class C: membership ───────────────────────────────────────────────
      const members = await tx.projectMember.findMany({
        where: { projectId },
        select: { userId: true },
      });
      const candidateIds = [...members.map((m) => m.userId), project.ownerId];
      const inTargetOrg = new Set(
        (
          await tx.orgMember.findMany({
            where: { orgId: toOrgId, userId: { in: candidateIds } },
            select: { userId: true },
          })
        ).map((m) => m.userId),
      );
      const purgeIds = members.map((m) => m.userId).filter((id) => !inTargetOrg.has(id));

      // `projects.ownerId` is non-nullable, so an owner who is not in the
      // target org must be replaced. The reviewer may nominate someone;
      // otherwise the reviewer takes it, since they are an admin of the org
      // that is now responsible for the project.
      let ownerId = project.ownerId;
      if (!inTargetOrg.has(project.ownerId)) {
        const nominee = dto.newOwnerId ?? reviewerId;
        const nomineeInOrg = await tx.orgMember.findUnique({
          where: { orgId_userId: { orgId: toOrgId, userId: nominee } },
          select: { userId: true },
        });
        if (!nomineeInOrg) {
          throw new BadRequestException('The nominated owner is not a member of your organisation');
        }
        ownerId = nominee;
      }

      if (purgeIds.length) {
        await tx.projectMember.deleteMany({ where: { projectId, userId: { in: purgeIds } } });
        // A sign-off approver who is no longer a member would block sign-off
        // forever with no way for the new org to clear them.
        await tx.signoffApprover.deleteMany({ where: { projectId, userId: { in: purgeIds } } });
      }

      // The new owner needs a real OWNER membership row, not just the FK.
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId, userId: ownerId } },
        create: { projectId, userId: ownerId, role: 'OWNER' },
        update: { role: 'OWNER' },
      });

      // ── Class B: sever bindings the source org owns ───────────────────────
      const severed: Record<string, number> = {};
      const count = (k: string, r: { count: number }) => {
        if (r.count > 0) severed[k] = r.count;
      };

      count(
        'projectPluginBinding',
        await tx.projectPluginBinding.updateMany({
          where: { projectId, deletedAt: null },
          data: { deletedAt: now },
        }),
      );
      if (scope.moduleIds.length) {
        count(
          'modulePluginBinding',
          await tx.modulePluginBinding.updateMany({
            where: { moduleId: { in: scope.moduleIds }, deletedAt: null },
            data: { deletedAt: now },
          }),
        );
      }
      if (scope.featureIds.length) {
        count(
          'featurePluginBinding',
          await tx.featurePluginBinding.updateMany({
            where: { featureId: { in: scope.featureIds }, deletedAt: null },
            data: { deletedAt: now },
          }),
        );
      }
      count(
        'ticketLink',
        await tx.ticketLink.updateMany({
          where: { deletedAt: null, ...this.plan.ticketFilter(projectId, scope) },
          data: { deletedAt: now },
        }),
      );
      count(
        'docLink',
        await tx.docLink.updateMany({
          where: { deletedAt: null, ...this.plan.treeFilter(projectId, scope) },
          data: { deletedAt: now },
        }),
      );
      if (scope.testIds.length) {
        // No deletedAt on this model — the link is a pointer into the source
        // org's ClickUp doc, so it is dropped outright.
        count(
          'testAcSourceLink',
          await tx.testAcSourceLink.deleteMany({ where: { testId: { in: scope.testIds } } }),
        );
      }
      // ProjectRepo.credentialId is non-nullable and points at an
      // OrgGitCredential of the source org, so the repo link cannot be kept
      // without leaking the source org's git token. Soft-delete and let the
      // target org reconnect with its own credential.
      count(
        'projectRepo',
        await tx.projectRepo.updateMany({
          where: { projectId, deletedAt: null },
          data: { deletedAt: now },
        }),
      );

      // ── Class A: content that follows ─────────────────────────────────────
      const docsMoved = await tx.doc.updateMany({
        where: { orgId: fromOrgId, ...this.plan.treeFilter(projectId, scope) },
        data: { orgId: toOrgId },
      });

      // Pending access requests were raised against the OLD org. Approving one
      // after the move would admit a source-org user into a target-org project,
      // so close them out with a reason instead of leaving them actionable.
      await tx.accessRequest.updateMany({
        where: { projectId, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          reviewedById: reviewerId,
          reviewedAt: now,
          reviewerNote: 'Project was transferred to another organisation',
        },
      });

      // ── The move itself ───────────────────────────────────────────────────
      const moved = await tx.project.update({
        where: { id: projectId },
        data: { orgId: toOrgId, slug, ownerId },
        select: { id: true, name: true, slug: true, orgId: true, ownerId: true },
      });

      const updatedRequest = await tx.projectTransferRequest.update({
        where: { id: requestId },
        data: {
          status: 'ACCEPTED',
          reviewedById: reviewerId,
          reviewedAt: now,
          decisionNote: dto.note ?? null,
        },
        include: {
          project: { select: { id: true, name: true, slug: true } },
          fromOrg: { select: { id: true, name: true } },
          toOrg: { select: { id: true, name: true } },
        },
      });

      return {
        request: updatedRequest,
        moved,
        executed: {
          slug,
          slugRenamed: slug !== project.slug,
          previousSlug: project.slug,
          membersPurged: purgeIds.length,
          ownerChanged: ownerId !== project.ownerId,
          previousOwnerId: project.ownerId,
          ownerId,
          docsMoved: docsMoved.count,
          severed,
        },
      };
    });

    await this.audit('project_transfer.accepted', result.request, reviewerId, result.executed);
    void this.emailAcceptance(result.request, reviewerId, result.executed);

    await this.notifyOrgAdmins(result.request.fromOrgId, {
      type: 'PROJECT_TRANSFER_ACCEPTED',
      title: 'Transfer complete',
      body: `"${result.request.project.name}" has moved to ${result.request.toOrg.name}.`,
      meta: { requestId },
    });
    await this.notifyOrgAdmins(result.request.toOrgId, {
      type: 'PROJECT_TRANSFER_ACCEPTED',
      title: 'Project received',
      body: `"${result.request.project.name}" is now part of your organisation.`,
      actionUrl: `/projects/${result.request.projectId}`,
      actionLabel: 'Open project',
      meta: { requestId },
    });

    return result;
  }

  // ── Listing ───────────────────────────────────────────────────────────────

  /** Transfers touching an org, in either direction. */
  async listForOrg(orgId: string, direction: 'in' | 'out' | 'all' = 'all', status?: string) {
    const where: Record<string, unknown> = {};
    if (direction === 'in') where['toOrgId'] = orgId;
    else if (direction === 'out') where['fromOrgId'] = orgId;
    else where['OR'] = [{ toOrgId: orgId }, { fromOrgId: orgId }];
    if (status) where['status'] = status;

    const rows = await this.prisma.projectTransferRequest.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, slug: true } },
        fromOrg: { select: { id: true, name: true } },
        toOrg: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => ({ ...r, direction: r.toOrgId === orgId ? 'in' : 'out' }));
  }

  async listForProject(projectId: string) {
    return this.prisma.projectTransferRequest.findMany({
      where: { projectId },
      include: {
        toOrg: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async loadPending(requestId: string, toOrgId: string) {
    const request = await this.prisma.projectTransferRequest.findUnique({
      where: { id: requestId },
      include: {
        project: { select: { id: true, name: true } },
        fromOrg: { select: { id: true, name: true } },
        toOrg: { select: { id: true, name: true } },
      },
    });
    // Scope check before status check: a request belonging to another org must
    // 404 identically whether or not it is still pending.
    if (!request || request.toOrgId !== toOrgId) {
      throw new NotFoundException('Transfer request not found');
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException('This transfer request has already been resolved');
    }
    if (request.expiresAt.getTime() < Date.now()) {
      await this.prisma.projectTransferRequest
        .update({ where: { id: requestId }, data: { status: 'EXPIRED' } })
        .catch(() => undefined);
      throw new ConflictException('This transfer request has expired');
    }
    return request;
  }

  private async orgAdminEmails(orgId: string): Promise<string[]> {
    const admins = await this.prisma.orgMember.findMany({
      where: { orgId, role: 'ORG_ADMIN', user: { accountStatus: 'ACTIVE' } },
      select: { user: { select: { email: true } } },
    });
    return admins.map((a) => a.user.email).filter(Boolean);
  }

  private async orgAdminIds(orgId: string): Promise<string[]> {
    const admins = await this.prisma.orgMember.findMany({
      where: { orgId, role: 'ORG_ADMIN', user: { accountStatus: 'ACTIVE' } },
      select: { userId: true },
    });
    return admins.map((a) => a.userId);
  }

  /** In-app notification to every active ORG_ADMIN of an org. */
  private async notifyOrgAdmins(
    orgId: string,
    n: {
      type: NotificationType;
      title: string;
      body: string;
      actionUrl?: string;
      actionLabel?: string;
      meta?: object;
    },
  ) {
    await this.safely(async () => {
      const userIds = await this.orgAdminIds(orgId);
      if (!userIds.length) return;
      await this.prisma.notification.createMany({
        data: userIds.map((userId) => ({
          orgId,
          userId,
          type: n.type,
          category: 'TEAM' as const,
          title: n.title,
          body: n.body,
          actionUrl: n.actionUrl ?? null,
          actionLabel: n.actionLabel ?? null,
          meta: (n.meta ?? {}) as object,
        })),
      });
    });
  }

  /** Turn a plan into the lines an admin reads before consenting. */
  private impactLines(plan: TransferPlan): string[] {
    const lines: string[] = [];
    if (plan.slugConflict) {
      lines.push(`The project URL will change to "${plan.suggestedSlug}" (that slug is already taken in ${plan.toOrgName}).`);
    }
    if (plan.membersToPurge.length) {
      lines.push(
        `${plan.membersToPurge.length} project member${plan.membersToPurge.length === 1 ? '' : 's'} not in ${plan.toOrgName} will lose access.`,
      );
    }
    if (plan.ownerNeedsReassign) {
      lines.push(`The project owner is not in ${plan.toOrgName}, so a new owner will be assigned.`);
    }
    if (plan.docsToMove) {
      lines.push(`${plan.docsToMove} document${plan.docsToMove === 1 ? '' : 's'} will move with the project.`);
    }
    for (const b of plan.bindingsToSever) {
      lines.push(`${b.count} × ${b.label.toLowerCase()} will be disconnected (they belong to the sending organisation).`);
    }
    if (!lines.length) lines.push('No members, documents or integrations are affected.');
    return lines;
  }

  private async emailTargetAdmins(
    request: {
      id: string;
      expiresAt: Date;
      message: string | null;
      project: { name: string };
      fromOrg: { name: string };
      toOrg: { id: string; name: string };
      requestedBy: { name: string | null; email: string };
    },
    plan: TransferPlan,
  ) {
    await this.safely(async () => {
      const emails = await this.orgAdminEmails(request.toOrg.id);
      if (!emails.length) {
        this.logger.warn(`Transfer ${request.id} targets org ${request.toOrg.id} with no active admins`);
        return;
      }
      await this.email.sendProjectTransferRequested(
        emails,
        {
          projectName: request.project.name,
          fromOrgName: request.fromOrg.name,
          toOrgName: request.toOrg.name,
          requesterName: request.requestedBy.name ?? request.requestedBy.email,
          requesterEmail: request.requestedBy.email,
          reviewUrl: `${webUrl()}/org/transfers`,
          expiresAt: request.expiresAt.toDateString(),
          impacts: this.impactLines(plan),
          message: request.message ?? undefined,
        },
        { name: request.toOrg.name },
      );
    });
  }

  private async emailAcceptance(
    request: {
      projectId: string;
      decisionNote: string | null;
      project: { name: string };
      fromOrg: { id: string; name: string };
      toOrg: { name: string };
    },
    reviewerId: string,
    executed: {
      membersPurged: number;
      ownerChanged: boolean;
      slugRenamed: boolean;
      slug: string;
      docsMoved: number;
      severed: Record<string, number>;
    },
  ) {
    await this.safely(async () => {
      const reviewer = await this.prisma.user.findUnique({
        where: { id: reviewerId },
        select: { name: true, email: true },
      });
      // Report what actually happened, not what was planned — the two can
      // differ if the project drifted between request and accept.
      const impacts: string[] = [];
      if (executed.slugRenamed) impacts.push(`The project URL is now "${executed.slug}".`);
      if (executed.membersPurged) impacts.push(`${executed.membersPurged} member(s) lost access.`);
      if (executed.ownerChanged) impacts.push('A new project owner was assigned.');
      if (executed.docsMoved) impacts.push(`${executed.docsMoved} document(s) moved with the project.`);
      const severedTotal = Object.values(executed.severed).reduce((a, b) => a + b, 0);
      if (severedTotal) impacts.push(`${severedTotal} integration link(s) were disconnected.`);

      const emails = await this.orgAdminEmails(request.fromOrg.id);
      if (!emails.length) return;
      await this.email.sendProjectTransferAccepted(
        emails,
        {
          projectName: request.project.name,
          fromOrgName: request.fromOrg.name,
          toOrgName: request.toOrg.name,
          reviewerName: reviewer?.name ?? reviewer?.email ?? 'An administrator',
          projectUrl: `${webUrl()}/projects/${request.projectId}`,
          impacts,
          note: request.decisionNote ?? undefined,
        },
        { name: request.fromOrg.name },
      );
    });
  }

  /**
   * Audit into BOTH orgs. `audit_logs` is queried per-org, so a single row
   * would make the transfer invisible from one side of it — and this is
   * precisely the event both sides need on record.
   */
  private async audit(
    action: string,
    request: { id: string; projectId: string; fromOrgId: string; toOrgId: string },
    userId: string,
    extra?: object,
  ) {
    await this.safely(async () => {
      const after = {
        requestId: request.id,
        projectId: request.projectId,
        fromOrgId: request.fromOrgId,
        toOrgId: request.toOrgId,
        ...(extra ?? {}),
      };
      await this.prisma.auditLog.createMany({
        data: [request.fromOrgId, request.toOrgId].map((orgId) => ({
          action,
          entity: 'ProjectTransferRequest',
          entityId: request.id,
          orgId,
          userId,
          after: after as object,
          source: 'web',
        })),
      });
    });
  }

  /** Side-effects (email, notifications, audit) must never fail the operation. */
  private async safely(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.warn(`transfer side-effect failed: ${(e as Error).message}`);
    }
  }
}
