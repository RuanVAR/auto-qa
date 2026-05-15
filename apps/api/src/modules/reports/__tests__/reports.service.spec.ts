/**
 * Unit tests for ReportsService — focused on the *new* behaviour added with
 * the cascade scope keys + Generate-and-Email work:
 *   1. listGenerated — cascade filter resolution (project / module / feature)
 *   2. getLatest    — single most recent at scope
 *   3. generate     — sanitises recipient list + denormalises scope keys +
 *                     fires email when recipients present (otherwise skips)
 *   4. getDefaultRecipients — pulls the right roster + dedupes
 *
 * The render pipeline (HTML / PDF / Puppeteer) is intentionally NOT exercised
 * here — those are covered by the existing integration suite. Unit tests
 * stub the heavy parts and focus on the routing logic.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ReportsService } from '../reports.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../../../email/email.service';
import { QueueService } from '../../queue/queue.service';
import { ReportType, ReportFormat } from '@prisma/client';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockPrisma = {
  generatedReport: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  reportConfig: {
    findUnique: jest.fn(),
  },
  feature: {
    findUnique: jest.fn(),
  },
  project: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  orgMember: {
    findMany: jest.fn(),
  },
  projectMember: {
    findMany: jest.fn(),
  },
  qaWorkSession: {
    findUnique: jest.fn(),
  },
};

const mockConfig = {
  get: jest.fn((key: string, def?: string) => {
    if (key === 'ARTIFACT_STORAGE_PATH') return '/tmp/qa-test-artifacts';
    if (key === 'PUBLIC_API_BASE_URL') return 'https://qa.example.com';
    return def;
  }),
};

const mockEmail = {
  sendReportGenerated: jest.fn(),
};

// Stub fs so the service constructor doesn't try to mkdir on disk during tests.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(() => Buffer.from('<html>fake</html>')),
}));

describe('ReportsService — cascade + email', () => {
  let service: ReportsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EmailService,  useValue: mockEmail },
        // Report PDF queue moved out of the request path — heavy PDF work
        // is enqueued for the worker. The cascade-routing tests never reach
        // that enqueue call, so a no-op stub is enough.
        { provide: QueueService,  useValue: { enqueueReportPdf: jest.fn(), enqueueRun: jest.fn() } },
      ],
    }).compile();

    service = module.get(ReportsService);
  });

  // ─── listGenerated ────────────────────────────────────────────────────────

  describe('listGenerated', () => {
    it('PROJECT scope — passes only projectId in the where clause', async () => {
      mockPrisma.generatedReport.findMany.mockResolvedValue([]);
      await service.listGenerated('proj-1');

      const args = mockPrisma.generatedReport.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ projectId: 'proj-1' });
    });

    it('MODULE scope — narrows by moduleId (no featureId)', async () => {
      mockPrisma.generatedReport.findMany.mockResolvedValue([]);
      await service.listGenerated('proj-1', { moduleId: 'mod-A' });

      const args = mockPrisma.generatedReport.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ projectId: 'proj-1', moduleId: 'mod-A' });
    });

    it('FEATURE scope — narrows by featureId, ignores moduleId for filter', async () => {
      // featureId implies the module — sending both would over-filter, so the
      // service drops moduleId when featureId is present.
      mockPrisma.generatedReport.findMany.mockResolvedValue([]);
      await service.listGenerated('proj-1', { moduleId: 'mod-A', featureId: 'feat-x' });

      const args = mockPrisma.generatedReport.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ projectId: 'proj-1', featureId: 'feat-x' });
      expect(args.where.moduleId).toBeUndefined();
    });

    it('respects custom limit', async () => {
      mockPrisma.generatedReport.findMany.mockResolvedValue([]);
      await service.listGenerated('proj-1', { limit: 5 });

      const args = mockPrisma.generatedReport.findMany.mock.calls[0][0];
      expect(args.take).toBe(5);
    });

    it('default limit is 50', async () => {
      mockPrisma.generatedReport.findMany.mockResolvedValue([]);
      await service.listGenerated('proj-1');

      const args = mockPrisma.generatedReport.findMany.mock.calls[0][0];
      expect(args.take).toBe(50);
    });
  });

  // ─── getLatest ────────────────────────────────────────────────────────────

  describe('getLatest', () => {
    it('returns the first row when results exist', async () => {
      const row = { id: 'r-1', title: 'My Report' };
      mockPrisma.generatedReport.findMany.mockResolvedValue([row]);

      const result = await service.getLatest('proj-1', { featureId: 'feat-x' });
      expect(result).toEqual(row);
    });

    it('returns null when no reports at scope', async () => {
      mockPrisma.generatedReport.findMany.mockResolvedValue([]);
      const result = await service.getLatest('proj-1');
      expect(result).toBeNull();
    });

    it('uses limit=1 internally', async () => {
      mockPrisma.generatedReport.findMany.mockResolvedValue([]);
      await service.getLatest('proj-1', { moduleId: 'mod-A' });

      const args = mockPrisma.generatedReport.findMany.mock.calls[0][0];
      expect(args.take).toBe(1);
    });
  });

  // ─── generate — scope-key denormalisation + email dispatch ────────────────

  describe('generate', () => {
    beforeEach(() => {
      // Default: feature lookup returns a module for cascading moduleId.
      mockPrisma.feature.findUnique.mockResolvedValue({ moduleId: 'mod-derived' });

      mockPrisma.generatedReport.create.mockImplementation(({ data }: { data: unknown }) =>
        Promise.resolve({ id: 'gen-1', ...(data as object) }),
      );
      mockPrisma.generatedReport.update.mockResolvedValue({});
      mockPrisma.generatedReport.findUnique.mockResolvedValue({
        id: 'gen-1', projectId: 'proj-1', payload: { summary: { passed: 5, failed: 1, totalRuns: 6 } },
        project: { name: 'Test Project' },
      });
      mockPrisma.user.findUnique.mockResolvedValue({ name: 'Sam', email: 'sam@test.com' });
      mockEmail.sendReportGenerated.mockResolvedValue({ id: 'email-1' });
    });

    it('feature-scoped report → derives moduleId when not supplied', async () => {
      // Force a minimal payload path — buildPayload is exercised via the
      // existing integration tests; here we just need it to not throw.
      const buildPayloadSpy = jest
        .spyOn(service as unknown as { buildPayload: jest.Mock }, 'buildPayload')
        .mockResolvedValue({ summary: { passed: 1, failed: 0, totalRuns: 1 } } as never);
      const renderHtmlSpy = jest
        .spyOn(service as unknown as { renderHtml: jest.Mock }, 'renderHtml')
        .mockReturnValue('<html>x</html>' as never);

      await service.generate('user-1', {
        projectId: 'proj-1',
        type: ReportType.FEATURE,
        featureId: 'feat-x',
        format: ReportFormat.HTML,
      });

      const createArgs = mockPrisma.generatedReport.create.mock.calls[0][0].data;
      expect(createArgs.featureId).toBe('feat-x');
      expect(createArgs.moduleId).toBe('mod-derived'); // ← cascade-up

      buildPayloadSpy.mockRestore();
      renderHtmlSpy.mockRestore();
    });

    it('passes through when moduleId is supplied with featureId', async () => {
      jest
        .spyOn(service as unknown as { buildPayload: jest.Mock }, 'buildPayload')
        .mockResolvedValue({} as never);
      jest
        .spyOn(service as unknown as { renderHtml: jest.Mock }, 'renderHtml')
        .mockReturnValue('<html>x</html>' as never);

      await service.generate('user-1', {
        projectId: 'proj-1',
        type: ReportType.FEATURE,
        featureId: 'feat-x',
        moduleId: 'mod-explicit',
        format: ReportFormat.HTML,
      });

      const createArgs = mockPrisma.generatedReport.create.mock.calls[0][0].data;
      expect(createArgs.moduleId).toBe('mod-explicit');
      expect(mockPrisma.feature.findUnique).not.toHaveBeenCalled();
    });

    it('sanitises recipient emails — drops invalid + dedupes + lowercases', async () => {
      jest
        .spyOn(service as unknown as { buildPayload: jest.Mock }, 'buildPayload')
        .mockResolvedValue({} as never);
      jest
        .spyOn(service as unknown as { renderHtml: jest.Mock }, 'renderHtml')
        .mockReturnValue('<html>x</html>' as never);

      await service.generate('user-1', {
        projectId: 'proj-1',
        type: ReportType.PROJECT,
        format: ReportFormat.HTML,
        recipientEmails: [
          'Valid@Test.com',
          'valid@test.com',     // dup
          'not-an-email',       // invalid
          '',                   // empty
          ' another@test.com ', // trim
        ],
      });

      const createArgs = mockPrisma.generatedReport.create.mock.calls[0][0].data;
      expect(createArgs.recipientEmails).toEqual(['valid@test.com', 'another@test.com']);
    });

    it('skips email dispatch when recipientEmails is empty', async () => {
      jest
        .spyOn(service as unknown as { buildPayload: jest.Mock }, 'buildPayload')
        .mockResolvedValue({} as never);
      jest
        .spyOn(service as unknown as { renderHtml: jest.Mock }, 'renderHtml')
        .mockReturnValue('<html>x</html>' as never);

      await service.generate('user-1', {
        projectId: 'proj-1',
        type: ReportType.PROJECT,
        format: ReportFormat.HTML,
      });

      // Wait microtask queue (dispatchReportEmail is fire-and-forget).
      await new Promise((r) => setImmediate(r));
      expect(mockEmail.sendReportGenerated).not.toHaveBeenCalled();
    });

    it('fires email when recipientEmails present and stamps emailedAt', async () => {
      jest
        .spyOn(service as unknown as { buildPayload: jest.Mock }, 'buildPayload')
        .mockResolvedValue({ summary: { passed: 5, failed: 1, totalRuns: 6 } } as never);
      jest
        .spyOn(service as unknown as { renderHtml: jest.Mock }, 'renderHtml')
        .mockReturnValue('<html>x</html>' as never);

      await service.generate('user-1', {
        projectId: 'proj-1',
        type: ReportType.PROJECT,
        format: ReportFormat.HTML,
        recipientEmails: ['boss@test.com'],
      });

      // Drain microtasks so the void-promise dispatchReportEmail resolves.
      await new Promise((r) => setImmediate(r));

      expect(mockEmail.sendReportGenerated).toHaveBeenCalledWith(
        ['boss@test.com'],
        expect.objectContaining({
          reportTitle: expect.any(String),
          projectName: 'Test Project',
          generatedBy: 'Sam',
          passed:     5,
          failed:     1,
          totalRuns:  6,
          passRate:   83, // 5/6 rounded
          // viewUrl moved from the API path to the web app route
          // (`/projects/:id?report=…`) so users land on the rendered page
          // rather than the raw artifact endpoint.
          viewUrl:    expect.stringContaining('/projects/'),
        }),
        expect.arrayContaining([expect.objectContaining({ filename: expect.any(String) })]),
      );

      // emailedAt update was dispatched
      const updateCalls = mockPrisma.generatedReport.update.mock.calls;
      const emailedUpdate = updateCalls.find(([arg]: [{ data: { emailedAt?: Date } }]) => arg.data.emailedAt);
      expect(emailedUpdate).toBeTruthy();
    });
  });

  // ─── getDefaultRecipients ─────────────────────────────────────────────────

  describe('getDefaultRecipients', () => {
    it('throws NotFoundException when project missing', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);
      await expect(service.getDefaultRecipients('nope')).rejects.toThrow(NotFoundException);
    });

    it('combines org admins + project managers, dedupes by email, ORG_ADMIN wins', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ orgId: 'org-1' });
      mockPrisma.orgMember.findMany.mockResolvedValue([
        { userId: 'u-admin' },
        { userId: 'u-shared' }, // also has project membership below
      ]);
      mockPrisma.projectMember.findMany.mockResolvedValue([
        { userId: 'u-shared',  role: 'OWNER' },
        { userId: 'u-mgr',     role: 'MANAGER' },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u-admin',  email: 'admin@test.com',  name: 'Admin' },
        { id: 'u-shared', email: 'shared@test.com', name: 'Shared' },
        { id: 'u-mgr',    email: 'mgr@test.com',    name: 'Manager' },
      ]);

      const result = await service.getDefaultRecipients('proj-1');

      // Sorted alphabetically by email
      expect(result).toEqual([
        { email: 'admin@test.com',  name: 'Admin',   role: 'ORG_ADMIN' },
        { email: 'mgr@test.com',    name: 'Manager', role: 'MANAGER' },
        { email: 'shared@test.com', name: 'Shared',  role: 'ORG_ADMIN' }, // ← admin role wins
      ]);
    });

    it('returns empty list when no eligible members', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ orgId: 'org-1' });
      mockPrisma.orgMember.findMany.mockResolvedValue([]);
      mockPrisma.projectMember.findMany.mockResolvedValue([]);

      const result = await service.getDefaultRecipients('proj-1');
      expect(result).toEqual([]);
    });

    it('excludes deactivated/suspended users (filtered at DB layer)', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ orgId: 'org-1' });
      mockPrisma.orgMember.findMany.mockResolvedValue([{ userId: 'u-deactivated' }]);
      mockPrisma.projectMember.findMany.mockResolvedValue([]);
      // Simulate the DB-level filter — the deactivated user simply not in results.
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.getDefaultRecipients('proj-1');
      expect(result).toEqual([]);

      // Verify the where clause asked for non-deactivated
      const whereArg = mockPrisma.user.findMany.mock.calls[0][0].where;
      expect(whereArg.accountStatus.notIn).toContain('DEACTIVATED');
      expect(whereArg.accountStatus.notIn).toContain('SUSPENDED');
    });
  });
});
