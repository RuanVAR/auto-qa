import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { EmailService } from '../src/email/email.service';
import { TransfersService } from '../src/modules/transfers/transfers.service';
import { TransferPlanService } from '../src/modules/transfers/transfer-plan.service';

/**
 * Project transfer — integration test against a REAL database.
 *
 * Deliberately not a mocked-Prisma unit test. Everything that makes a transfer
 * dangerous is database behaviour: the multi-table sweeps, the
 * `@@unique([orgId, slug])` collision, the one-pending-per-project partial
 * index, and the accept transaction's isolation. Mocking Prisma here would
 * assert that the mocks were called, not that a project can no longer leak
 * across an org boundary.
 *
 * Runs under `pnpm test:e2e` (not the default unit run), needs DATABASE_URL,
 * and boots only the transfer providers — no AppModule, so no port conflicts
 * with a running dev API.
 */

const email = {
  sendProjectTransferRequested: jest.fn().mockResolvedValue(undefined),
  sendProjectTransferAccepted: jest.fn().mockResolvedValue(undefined),
  sendProjectTransferRejected: jest.fn().mockResolvedValue(undefined),
  sendProjectTransferCancelled: jest.fn().mockResolvedValue(undefined),
};

describe('Project transfer (integration)', () => {
  let prisma: PrismaService;
  let transfers: TransfersService;

  // Unique per run so repeated local runs don't collide on unique columns.
  const tag = `xfer-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const ids: { orgs: string[]; users: string[] } = { orgs: [], users: [] };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        TransferPlanService,
        TransfersService,
        { provide: EmailService, useValue: email },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    transfers = moduleRef.get(TransfersService);
  });

  afterAll(async () => {
    // Orgs cascade to most children; users are referenced by RESTRICT FKs in
    // places, so drop org-owned rows first, then users.
    for (const orgId of ids.orgs) {
      await prisma.projectTransferRequest.deleteMany({
        where: { OR: [{ fromOrgId: orgId }, { toOrgId: orgId }] },
      });
      await prisma.auditLog.deleteMany({ where: { orgId } });
      await prisma.notification.deleteMany({ where: { orgId } });
      await prisma.project.deleteMany({ where: { orgId } });
      await prisma.organisation.deleteMany({ where: { id: orgId } });
    }
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.$disconnect();
  });

  const mkUser = async (label: string) => {
    const u = await prisma.user.create({
      data: { email: `${tag}-${label}@test.local`, name: `${label} user`, accountStatus: 'ACTIVE' },
    });
    ids.users.push(u.id);
    return u;
  };

  const mkOrg = async (label: string, ownerId: string) => {
    const o = await prisma.organisation.create({
      data: { name: `${label} org`, slug: `${tag}-${label}`, ownerId },
    });
    ids.orgs.push(o.id);
    return o;
  };

  /**
   * A source org with a project, and a target org — the minimum shape a
   * transfer has to survive.
   */
  const scenario = async (label: string) => {
    const owner = await mkUser(`${label}-owner`);
    const stayer = await mkUser(`${label}-stayer`); // in BOTH orgs → keeps access
    const leaver = await mkUser(`${label}-leaver`); // source org only → purged
    const targetAdmin = await mkUser(`${label}-tadmin`);

    const fromOrg = await mkOrg(`${label}-from`, owner.id);
    const toOrg = await mkOrg(`${label}-to`, targetAdmin.id);

    await prisma.orgMember.createMany({
      data: [
        { orgId: fromOrg.id, userId: owner.id, role: 'ORG_ADMIN' },
        { orgId: fromOrg.id, userId: stayer.id, role: 'ORG_MEMBER' },
        { orgId: fromOrg.id, userId: leaver.id, role: 'ORG_MEMBER' },
        { orgId: toOrg.id, userId: targetAdmin.id, role: 'ORG_ADMIN' },
        { orgId: toOrg.id, userId: stayer.id, role: 'ORG_MEMBER' },
      ],
    });

    const project = await prisma.project.create({
      data: { name: `${label} project`, slug: `${tag}-${label}-proj`, orgId: fromOrg.id, ownerId: owner.id },
    });
    await prisma.projectMember.createMany({
      data: [
        { projectId: project.id, userId: owner.id, role: 'OWNER' },
        { projectId: project.id, userId: stayer.id, role: 'QA_ENGINEER' },
        { projectId: project.id, userId: leaver.id, role: 'DEVELOPER' },
      ],
    });

    const { transferCode } = await transfers.rotateCode(toOrg.id);
    return { owner, stayer, leaver, targetAdmin, fromOrg, toOrg, project, transferCode };
  };

  // ── Code resolution ───────────────────────────────────────────────────────

  it('resolves a valid code to the org NAME ONLY — never its id', async () => {
    const s = await scenario('code');
    const res = await transfers.validateCode(s.project.id, { code: s.transferCode }, s.owner.id);

    expect(res).toEqual({ valid: true, orgName: s.toOrg.name });
    // The id would let a caller address an org it cannot otherwise see.
    expect(JSON.stringify(res)).not.toContain(s.toOrg.id);
  });

  it('reports an unknown code as invalid rather than throwing (no enumeration oracle)', async () => {
    const s = await scenario('unknown');
    const res = await transfers.validateCode(s.project.id, { code: 'ZZZZZZZZZZZZ' }, s.owner.id);
    expect(res).toEqual({ valid: false, reason: 'UNKNOWN_CODE' });
  });

  it('refuses a code belonging to the project’s own org', async () => {
    const s = await scenario('same');
    const { transferCode } = await transfers.rotateCode(s.fromOrg.id);
    const res = await transfers.validateCode(s.project.id, { code: transferCode }, s.owner.id);
    expect(res).toEqual({ valid: false, reason: 'SAME_ORG' });
  });

  it('refuses an org that has opted out of transfers', async () => {
    const s = await scenario('optout');
    await transfers.setAcceptsTransfers(s.toOrg.id, false);
    const res = await transfers.validateCode(s.project.id, { code: s.transferCode }, s.owner.id);
    expect(res).toEqual({ valid: false, reason: 'NOT_ACCEPTING' });
  });

  it('rotating a code invalidates the previous one immediately', async () => {
    const s = await scenario('rotate');
    const old = s.transferCode;
    const { transferCode: fresh } = await transfers.rotateCode(s.toOrg.id);

    expect(fresh).not.toEqual(old);
    expect(await transfers.validateCode(s.project.id, { code: old }, s.owner.id)).toEqual({
      valid: false,
      reason: 'UNKNOWN_CODE',
    });
    expect(await transfers.validateCode(s.project.id, { code: fresh }, s.owner.id)).toEqual({
      valid: true,
      orgName: s.toOrg.name,
    });
  });

  // ── Requesting ────────────────────────────────────────────────────────────

  it('allows only one pending request per project', async () => {
    const s = await scenario('dup');
    await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });
    await expect(
      transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a request raised with a bad code', async () => {
    const s = await scenario('badcode');
    await expect(
      transfers.createRequest(s.project.id, s.owner.id, { code: 'NOPENOPENOPE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── Accept: the transaction ───────────────────────────────────────────────

  it('moves the project and purges members who are not in the target org', async () => {
    const s = await scenario('accept');
    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });

    await transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {});

    const moved = await prisma.project.findUnique({ where: { id: s.project.id } });
    expect(moved!.orgId).toBe(s.toOrg.id);

    const memberIds = (
      await prisma.projectMember.findMany({ where: { projectId: s.project.id }, select: { userId: true } })
    ).map((m) => m.userId);

    // The leaver was in the source org only — keeping them would be exactly the
    // cross-org access leak this feature must not create.
    expect(memberIds).not.toContain(s.leaver.id);
    // The stayer is in both orgs, so the move is not a reason to drop them.
    expect(memberIds).toContain(s.stayer.id);
  });

  it('reassigns the owner when the current owner is not in the target org', async () => {
    const s = await scenario('owner');
    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });

    await transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {});

    const moved = await prisma.project.findUnique({ where: { id: s.project.id } });
    // ownerId is non-nullable, so the owner cannot simply be purged.
    expect(moved!.ownerId).toBe(s.targetAdmin.id);

    const ownerRow = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: s.project.id, userId: s.targetAdmin.id } },
    });
    expect(ownerRow?.role).toBe('OWNER');
  });

  it('honours a nominated owner, and refuses one outside the target org', async () => {
    const s = await scenario('nominee');
    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });

    // The leaver is not in the target org — nominating them would reintroduce
    // the leak through the back door.
    await expect(
      transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, { newOwnerId: s.leaver.id }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Still pending after the failed accept — the transaction rolled back.
    const stillPending = await prisma.projectTransferRequest.findUnique({ where: { id: req.id } });
    expect(stillPending!.status).toBe('PENDING');

    await transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, { newOwnerId: s.stayer.id });
    const moved = await prisma.project.findUnique({ where: { id: s.project.id } });
    expect(moved!.ownerId).toBe(s.stayer.id);
  });

  it('renames the slug when the target org already uses it', async () => {
    const s = await scenario('slug');
    // Park a project on the same slug in the target org.
    await prisma.project.create({
      data: {
        name: 'squatter',
        slug: s.project.slug,
        orgId: s.toOrg.id,
        ownerId: s.targetAdmin.id,
      },
    });

    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });
    const res = await transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {});

    expect(res.executed.slugRenamed).toBe(true);
    const moved = await prisma.project.findUnique({ where: { id: s.project.id } });
    expect(moved!.slug).toBe(`${s.project.slug}-2`);
    expect(moved!.orgId).toBe(s.toOrg.id);
  });

  it('renames around an ARCHIVED project holding the slug', async () => {
    const s = await scenario('archived');
    // The unique index covers soft-deleted rows, so an archived project still
    // owns the slug even though nothing in the UI shows it.
    await prisma.project.create({
      data: {
        name: 'archived squatter',
        slug: s.project.slug,
        orgId: s.toOrg.id,
        ownerId: s.targetAdmin.id,
        deletedAt: new Date(),
      },
    });

    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });
    const res = await transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {});

    expect(res.executed.slugRenamed).toBe(true);
    const moved = await prisma.project.findUnique({ where: { id: s.project.id } });
    expect(moved!.slug).toBe(`${s.project.slug}-2`);
  });

  it('re-points the project’s docs at the target org', async () => {
    const s = await scenario('docs');
    const doc = await prisma.doc.create({
      data: { orgId: s.fromOrg.id, projectId: s.project.id, title: 'spec', markdown: '# spec' },
    });
    const mod = await prisma.module.create({
      data: { projectId: s.project.id, name: 'mod' },
    });
    const modDoc = await prisma.doc.create({
      data: { orgId: s.fromOrg.id, moduleId: mod.id, title: 'module notes', markdown: 'x' },
    });

    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });
    await transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {});

    // Left behind, the target org could not read its own project's docs while
    // the source org still could.
    expect((await prisma.doc.findUnique({ where: { id: doc.id } }))!.orgId).toBe(s.toOrg.id);
    // Docs hang off modules too, not just the project row.
    expect((await prisma.doc.findUnique({ where: { id: modDoc.id } }))!.orgId).toBe(s.toOrg.id);
  });

  it('severs plugin bindings that point at the source org’s install', async () => {
    const s = await scenario('bindings');
    const install = await prisma.orgPluginInstall.create({
      data: {
        orgId: s.fromOrg.id,
        pluginId: 'clickup',
        pluginVersion: '1.0.0',
        config: {},
        secretsCiphertext: Buffer.from('secret'),
        secretsKeyId: 'dev-v1',
        installedById: s.owner.id,
      },
    });
    const binding = await prisma.projectPluginBinding.create({
      data: { orgId: s.fromOrg.id, projectId: s.project.id, installId: install.id, bindingConfig: {} },
    });

    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });
    const res = await transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {});

    // The install belongs to the SOURCE org and stays there. A live binding
    // would hand the target org use of the source org's ClickUp credentials.
    const after = await prisma.projectPluginBinding.findUnique({ where: { id: binding.id } });
    expect(after!.deletedAt).not.toBeNull();
    expect(res.executed.severed['projectPluginBinding']).toBe(1);
  });

  it('closes pending access requests raised against the old org', async () => {
    const s = await scenario('ar');
    const ar = await prisma.accessRequest.create({
      data: {
        type: 'PROJECT',
        orgId: s.fromOrg.id,
        projectId: s.project.id,
        requesterId: s.leaver.id,
        status: 'PENDING',
      },
    });

    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });
    await transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {});

    // Approving this after the move would admit a source-org user into a
    // project the target org now owns.
    expect((await prisma.accessRequest.findUnique({ where: { id: ar.id } }))!.status).toBe('REJECTED');
  });

  // ── Scope + concurrency ───────────────────────────────────────────────────

  it('404s when an org tries to accept a request aimed at someone else', async () => {
    const s = await scenario('scope');
    const other = await mkUser('scope-other');
    const otherOrg = await mkOrg('scope-other', other.id);
    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });

    // A request id alone must not be enough to accept it.
    await expect(transfers.accept(req.id, otherOrg.id, other.id, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(transfers.getForReview(req.id, otherOrg.id)).rejects.toBeInstanceOf(NotFoundException);

    const untouched = await prisma.project.findUnique({ where: { id: s.project.id } });
    expect(untouched!.orgId).toBe(s.fromOrg.id);
  });

  it('accepts once when two admins accept concurrently', async () => {
    const s = await scenario('race');
    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });

    const results = await Promise.allSettled([
      transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {}),
      transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {}),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    // The second must lose rather than run the move twice.
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((await prisma.project.findUnique({ where: { id: s.project.id } }))!.orgId).toBe(s.toOrg.id);
  });

  it('does not let a reject overwrite the decision of a concurrent accept', async () => {
    const s = await scenario('rejectrace');
    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });

    const results = await Promise.allSettled([
      transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {}),
      transfers.reject(req.id, s.toOrg.id, s.targetAdmin.id, {}),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    // Whichever won, the stored status must match what actually happened to the
    // project — a REJECTED request over a moved project would be a lie.
    const final = await prisma.projectTransferRequest.findUnique({ where: { id: req.id } });
    const project = await prisma.project.findUnique({ where: { id: s.project.id } });
    if (final!.status === 'ACCEPTED') expect(project!.orgId).toBe(s.toOrg.id);
    else expect(project!.orgId).toBe(s.fromOrg.id);
  });

  it('refuses to accept a request twice', async () => {
    const s = await scenario('twice');
    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });
    await transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {});

    await expect(transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses to accept an expired request', async () => {
    const s = await scenario('expired');
    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });
    await prisma.projectTransferRequest.update({
      where: { id: req.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect((await prisma.projectTransferRequest.findUnique({ where: { id: req.id } }))!.status).toBe(
      'EXPIRED',
    );
  });

  // ── Reject / cancel ───────────────────────────────────────────────────────

  it('leaves the project alone on reject', async () => {
    const s = await scenario('reject');
    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });

    await transfers.reject(req.id, s.toOrg.id, s.targetAdmin.id, { note: 'no thanks' });

    const p = await prisma.project.findUnique({ where: { id: s.project.id } });
    expect(p!.orgId).toBe(s.fromOrg.id);
    const memberIds = (
      await prisma.projectMember.findMany({ where: { projectId: s.project.id }, select: { userId: true } })
    ).map((m) => m.userId);
    expect(memberIds).toContain(s.leaver.id);
  });

  it('frees the project for a new request after a cancel', async () => {
    const s = await scenario('cancel');
    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });
    await transfers.cancelRequest(s.project.id, req.id, s.owner.id);

    expect((await prisma.projectTransferRequest.findUnique({ where: { id: req.id } }))!.status).toBe(
      'CANCELLED',
    );
    // The partial unique index only covers PENDING rows, so a fresh request
    // must now be possible.
    const again = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });
    expect(again.status).toBe('PENDING');
  });

  it('404s when cancelling a request under a different project', async () => {
    const s = await scenario('cancelscope');
    const other = await scenario('cancelscope2');
    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });

    await expect(
      transfers.cancelRequest(other.project.id, req.id, other.owner.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── Audit ─────────────────────────────────────────────────────────────────

  it('audits an accepted transfer into BOTH orgs', async () => {
    const s = await scenario('audit');
    const req = await transfers.createRequest(s.project.id, s.owner.id, { code: s.transferCode });
    await transfers.accept(req.id, s.toOrg.id, s.targetAdmin.id, {});

    const rows = await prisma.auditLog.findMany({
      where: { entityId: req.id, action: 'project_transfer.accepted' },
      select: { orgId: true },
    });
    // audit_logs is queried per-org — one row would make the move invisible
    // from one side of the very event both sides need on record.
    const orgIds = rows.map((r) => r.orgId).sort();
    expect(orgIds).toEqual([s.fromOrg.id, s.toOrg.id].sort());
  });
});
