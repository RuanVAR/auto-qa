import { Prisma } from '@prisma/client';
import type { RepoIndexProgressEvent } from '@qa-platform/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { NotificationsService } from './notifications.service';

const baseEvent: RepoIndexProgressEvent = {
  orgId: 'org-1',
  projectId: 'project-1',
  repoId: 'repo-1',
  branchIndexId: 'index-1',
  branch: 'main',
  status: 'READY',
  stage: 'COMPLETE',
  progressPercent: 100,
  filesProcessed: 10,
  totalFiles: 10,
  chunkCount: 40,
  generation: 3,
  trigger: 'INITIAL',
  requestedById: 'user-1',
  commitSha: 'abcdef1234567890',
  embeddingFingerprint: 'embedding-v1',
  durationMs: 15_000,
};

describe('NotificationsService code-index delivery', () => {
  const repoBranchIndex = {
    findFirst: jest.fn(),
  };
  const orgMember = {
    findMany: jest.fn(),
  };
  const user = {
    findMany: jest.fn(),
  };
  const notification = {
    create: jest.fn(),
  };
  const prisma = {
    repoBranchIndex,
    orgMember,
    user,
    notification,
  };
  const email = {
    sendCodeIndexNotification: jest.fn(),
  };
  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    repoBranchIndex.findFirst.mockResolvedValue({
      requestedGeneration: 3,
      requestedById: 'user-1',
      project: { name: 'QA Project' },
      org: { name: 'QA Org', logoUrl: null },
      projectRepo: { repoOwner: 'owner', repoName: 'web' },
    });
    orgMember.findMany.mockResolvedValue([]);
    user.findMany.mockResolvedValue([{
      id: 'user-1',
      email: 'user@example.com',
      notificationPrefs: {},
    }]);
    notification.create.mockResolvedValue({ id: 'notification-1' });
    email.sendCodeIndexNotification.mockResolvedValue(null);
    service = new NotificationsService(
      prisma as unknown as PrismaService,
      email as unknown as EmailService,
    );
  });

  it('notifies only the triggering user when an initial index becomes ready', async () => {
    await service.notifyCodeIndex(baseEvent);

    expect(orgMember.findMany).not.toHaveBeenCalled();
    expect(user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['user-1'] } }),
    }));
    expect(notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: 'CODE_INDEX_READY',
        dedupeKey: 'code-index:ready:index-1:3:user-1',
        actionUrl: '/projects/project-1?tab=integrations&repo=repo-1#repo-index-index-1',
      }),
    });
    expect(email.sendCodeIndexNotification).not.toHaveBeenCalled();
  });

  it('notifies the requester and org admins by email when a manual index fails', async () => {
    orgMember.findMany.mockResolvedValue([
      { userId: 'admin-1' },
      { userId: 'user-1' },
    ]);
    user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        email: 'user@example.com',
        notificationPrefs: {},
      },
      {
        id: 'admin-1',
        email: 'admin@example.com',
        notificationPrefs: {},
      },
    ]);

    await service.notifyCodeIndex({
      ...baseEvent,
      status: 'FAILED',
      stage: 'EMBEDDING',
      trigger: 'MANUAL',
      error: 'provider unavailable',
    });

    expect(notification.create).toHaveBeenCalledTimes(2);
    expect(email.sendCodeIndexNotification).toHaveBeenCalledTimes(2);
    expect(email.sendCodeIndexNotification).toHaveBeenCalledWith(
      'admin@example.com',
      expect.objectContaining({
        status: 'FAILED',
        error: 'provider unavailable',
      }),
      { name: 'QA Org', logoUrl: null },
    );
  });

  it('suppresses scheduled success notifications', async () => {
    await service.notifyCodeIndex({
      ...baseEvent,
      trigger: 'SCHEDULED',
    });

    expect(user.findMany).not.toHaveBeenCalled();
    expect(notification.create).not.toHaveBeenCalled();
    expect(email.sendCodeIndexNotification).not.toHaveBeenCalled();
  });

  it('does not send email again when the delivery key already exists', async () => {
    notification.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    await service.notifyCodeIndex({
      ...baseEvent,
      status: 'FAILED',
      trigger: 'MANUAL',
      error: 'provider unavailable',
    });

    expect(email.sendCodeIndexNotification).not.toHaveBeenCalled();
  });

  it('ignores a terminal event from a superseded generation', async () => {
    repoBranchIndex.findFirst.mockResolvedValue({
      requestedGeneration: 4,
      requestedById: 'user-1',
      project: { name: 'QA Project' },
      org: { name: 'QA Org', logoUrl: null },
      projectRepo: { repoOwner: 'owner', repoName: 'web' },
    });

    await service.notifyCodeIndex(baseEvent);

    expect(notification.create).not.toHaveBeenCalled();
  });
});
