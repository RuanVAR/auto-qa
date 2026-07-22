import { DefectSyncService } from './defect-sync.service';
import { InboundSyncService } from './inbound-sync.service';

const install = { id: 'install-1', config: { workspaceId: 'workspace-1' }, isEnabled: true, lastHealthOk: true, deletedAt: null };

describe('ClickUp defect lifecycle', () => {
  it('closes a linked defect when ClickUp reports a terminal closed status', async () => {
    const prisma = {
      ticketLink: {
        findUnique: jest.fn().mockResolvedValue({ id: 'link-1', installId: install.id, defectId: 'defect-1', externalStatus: 'In progress', deletedAt: null, install }),
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'link-1', externalStatus: 'Done' }),
      },
      defect: {
        findUnique: jest.fn().mockResolvedValue({ projectId: 'project-1', status: 'OPEN' }),
        update: jest.fn().mockResolvedValue({}),
      },
      projectPluginBinding: { findFirst: jest.fn().mockResolvedValue(null) },
      pluginStatusMapping: { findFirst: jest.fn() },
      ticketStatusSuggestion: { create: jest.fn().mockResolvedValue({ id: 'suggestion-1' }) },
    } as any;
    const plugins = { dispatch: jest.fn().mockResolvedValue({ externalStatus: 'Done', externalStatusType: 'closed', externalLastUpdatedAt: new Date().toISOString() }) } as any;
    const service = new InboundSyncService(prisma, plugins, {} as any);

    const result = await service.refreshTicket('link-1', 'WEBHOOK');

    expect(prisma.defect.update).toHaveBeenCalledWith({ where: { id: 'defect-1' }, data: { status: 'CLOSED' } });
    expect(prisma.ticketStatusSuggestion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ suggestionKind: 'AUTO_APPLIED', mappedStatus: 'CLOSED' }) }));
    expect(result.applied).toBe(true);
  });

  it('keeps a mapped reopen pending when inbound auto-apply is disabled', async () => {
    const prisma = {
      ticketLink: {
        findUnique: jest.fn().mockResolvedValue({ id: 'link-1', installId: install.id, defectId: 'defect-1', externalStatus: 'Done', deletedAt: null, install }),
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'link-1', externalStatus: 'Reopened' }),
      },
      defect: {
        findUnique: jest.fn().mockResolvedValue({ projectId: 'project-1', status: 'CLOSED' }),
        update: jest.fn(),
      },
      projectPluginBinding: { findFirst: jest.fn().mockResolvedValue({ id: 'binding-1', autoApplyInboundStatus: false }) },
      pluginStatusMapping: { findFirst: jest.fn().mockResolvedValue({ platformValue: 'OPEN' }) },
      ticketStatusSuggestion: { create: jest.fn().mockResolvedValue({ id: 'suggestion-1' }) },
    } as any;
    const plugins = { dispatch: jest.fn().mockResolvedValue({ externalStatus: 'Reopened', externalStatusType: 'custom', externalLastUpdatedAt: new Date().toISOString() }) } as any;
    const service = new InboundSyncService(prisma, plugins, {} as any);

    const result = await service.refreshTicket('link-1', 'WEBHOOK');

    expect(prisma.defect.update).not.toHaveBeenCalled();
    expect(prisma.ticketStatusSuggestion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ suggestionKind: 'PENDING_APPROVAL', mappedStatus: 'OPEN' }) }));
    expect(result.applied).toBe(false);
  });

  it('pushes an outbound mapped defect status and records the sync result', async () => {
    const prisma = {
      defect: { findUnique: jest.fn().mockResolvedValue({ projectId: 'project-1' }) },
      ticketLink: {
        findMany: jest.fn().mockResolvedValue([{ id: 'link-1', installId: install.id, externalId: 'task-1', install }]),
        update: jest.fn().mockResolvedValue({}),
      },
      projectPluginBinding: {
        findMany: jest.fn().mockResolvedValue([{
          installId: install.id,
          bindingConfig: { defaultListId: 'list-1' },
          statusMappings: [{ externalValue: 'Resolved' }],
        }]),
      },
    } as any;
    const plugins = { dispatch: jest.fn().mockResolvedValue({ externalStatus: 'Resolved' }) } as any;
    const service = new DefectSyncService(prisma, plugins);

    await (service as any).runSync('defect-1', 'RESOLVED');

    expect(plugins.dispatch).toHaveBeenCalledWith(
      'syncTicketStatus',
      install.id,
      expect.objectContaining({ externalId: 'task-1', platformStatus: 'RESOLVED', targetExternalStatus: 'Resolved' }),
      expect.objectContaining({ defaultListId: 'list-1', workspaceId: 'workspace-1' }),
    );
    expect(prisma.ticketLink.update).toHaveBeenCalledWith({
      where: { id: 'link-1' },
      data: { lastOutboundSyncAt: expect.any(Date), lastOutboundSyncError: null },
    });
  });
});
