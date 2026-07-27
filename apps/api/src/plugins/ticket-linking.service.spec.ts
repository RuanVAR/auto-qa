import { NotFoundException, BadRequestException, BadGatewayException } from '@nestjs/common';
import { TicketLinkingService } from './ticket-linking.service';

const healthyBinding = {
  id: 'binding-1',
  installId: 'install-1',
  install: { id: 'install-1', orgId: 'org-1' },
};

/** Prisma double with just the tables/methods this service touches. */
function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    feature: { findUnique: jest.fn() },
    module: { findUnique: jest.fn() },
    defect: { findUnique: jest.fn() },
    issue: { findUnique: jest.fn() },
    projectPluginBinding: { findFirst: jest.fn().mockResolvedValue(healthyBinding) },
    ticketLink: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'link-new', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'link-existing', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as any;
}

const createdTicket = {
  externalId: 'CU-1',
  externalUrl: 'https://app.clickup.com/t/CU-1',
  externalTitle: 'Feature: Login',
  externalStatus: 'To Do',
};

describe('TicketLinkingService', () => {
  describe('resolveEntity / projectIdOf', () => {
    it('resolves a feature to its module.projectId', async () => {
      const prisma = makePrisma();
      prisma.feature.findUnique.mockResolvedValue({ name: 'Login', module: { projectId: 'project-1' } });
      const svc = new TicketLinkingService(prisma, {} as any, {} as any);
      await expect(svc.projectIdOf('feature', 'feat-1')).resolves.toBe('project-1');
    });

    it('404s when the entity is gone', async () => {
      const prisma = makePrisma();
      prisma.module.findUnique.mockResolvedValue(null);
      const svc = new TicketLinkingService(prisma, {} as any, {} as any);
      await expect(svc.projectIdOf('module', 'mod-x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createTicket', () => {
    it('dispatches createIssue and persists a new TicketLink', async () => {
      const prisma = makePrisma();
      prisma.feature.findUnique.mockResolvedValue({ name: 'Login', module: { projectId: 'project-1' } });
      const plugins = { dispatch: jest.fn().mockResolvedValue(createdTicket) } as any;
      const scopeResolver = { resolve: jest.fn().mockResolvedValue({ listId: 'list-1' }) } as any;
      const svc = new TicketLinkingService(prisma, plugins, scopeResolver);

      const link = await svc.createTicket('feature', 'feat-1', 'user-1', { title: 'Custom title' });

      expect(plugins.dispatch).toHaveBeenCalledWith(
        'createIssue',
        'install-1',
        expect.objectContaining({ title: 'Custom title', scope: expect.objectContaining({ kind: 'feature', featureId: 'feat-1' }) }),
        { listId: 'list-1' },
        { actingUserId: 'user-1' },
      );
      expect(prisma.ticketLink.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', installId: 'install-1', projectId: 'project-1', featureId: 'feat-1', externalId: 'CU-1' }) }),
      );
      expect(link.externalId).toBe('CU-1');
    });

    it('404s when no healthy ClickUp binding exists', async () => {
      const prisma = makePrisma({ projectPluginBinding: { findFirst: jest.fn().mockResolvedValue(null) } });
      prisma.feature.findUnique.mockResolvedValue({ name: 'Login', module: { projectId: 'project-1' } });
      const plugins = { dispatch: jest.fn() } as any;
      const svc = new TicketLinkingService(prisma, plugins, { resolve: jest.fn() } as any);
      await expect(svc.createTicket('feature', 'feat-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(plugins.dispatch).not.toHaveBeenCalled();
    });

    it('wraps a dispatch failure as BadGateway', async () => {
      const prisma = makePrisma();
      prisma.issue.findUnique.mockResolvedValue({ title: 'Broken thing', projectId: 'project-1' });
      const plugins = { dispatch: jest.fn().mockRejectedValue(new Error('ClickUp 500')) } as any;
      const svc = new TicketLinkingService(prisma, plugins, { resolve: jest.fn().mockResolvedValue({}) } as any);
      await expect(svc.createTicket('issue', 'iss-1', 'user-1')).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('updates an existing active link instead of creating a duplicate', async () => {
      const prisma = makePrisma();
      prisma.feature.findUnique.mockResolvedValue({ name: 'Login', module: { projectId: 'project-1' } });
      prisma.ticketLink.findFirst.mockResolvedValue({ id: 'link-existing' });
      const plugins = { dispatch: jest.fn().mockResolvedValue(createdTicket) } as any;
      const svc = new TicketLinkingService(prisma, plugins, { resolve: jest.fn().mockResolvedValue({}) } as any);

      await svc.createTicket('feature', 'feat-1', 'user-1');

      expect(prisma.ticketLink.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'link-existing' } }));
      expect(prisma.ticketLink.create).not.toHaveBeenCalled();
    });
  });

  describe('linkTicket', () => {
    it('rejects a blank ticketRef', async () => {
      const svc = new TicketLinkingService(makePrisma(), {} as any, {} as any);
      await expect(svc.linkTicket('feature', 'feat-1', '   ', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('dispatches linkTicket with the trimmed ref and persists', async () => {
      const prisma = makePrisma();
      prisma.defect.findUnique.mockResolvedValue({ title: 'Flaky', projectId: 'project-1' });
      const linked = { ...createdTicket, externalStatusColor: '#fff', externalStatusType: 'open' };
      const plugins = { dispatch: jest.fn().mockResolvedValue(linked) } as any;
      const svc = new TicketLinkingService(prisma, plugins, { resolve: jest.fn().mockResolvedValue({}) } as any);

      await svc.linkTicket('defect', 'def-1', '  https://app.clickup.com/t/CU-1  ', 'user-1');

      expect(plugins.dispatch).toHaveBeenCalledWith(
        'linkTicket',
        'install-1',
        expect.objectContaining({ ticketRef: 'https://app.clickup.com/t/CU-1', scope: expect.objectContaining({ kind: 'defect', defectId: 'def-1' }) }),
        {},
        { actingUserId: 'user-1' },
      );
      expect(prisma.ticketLink.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ defectId: 'def-1', externalStatusColor: '#fff', externalStatusType: 'open' }) }),
      );
    });
  });

  describe('unlinkTicket', () => {
    it('soft-deletes active links and returns the count (no ClickUp write)', async () => {
      const prisma = makePrisma();
      prisma.module.findUnique.mockResolvedValue({ name: 'Auth', projectId: 'project-1' });
      const plugins = { dispatch: jest.fn() } as any;
      const svc = new TicketLinkingService(prisma, plugins, {} as any);

      const res = await svc.unlinkTicket('module', 'mod-1');

      expect(res).toEqual({ unlinked: 2 });
      expect(prisma.ticketLink.updateMany).toHaveBeenCalledWith({
        where: { moduleId: 'mod-1', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(plugins.dispatch).not.toHaveBeenCalled();
    });

    it('404s when the entity does not exist', async () => {
      const prisma = makePrisma();
      prisma.module.findUnique.mockResolvedValue(null);
      const svc = new TicketLinkingService(prisma, {} as any, {} as any);
      await expect(svc.unlinkTicket('module', 'gone')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
