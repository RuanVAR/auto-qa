import {
  AccountStatus,
  NotificationCategory,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

const runIntegration = process.env.CODE_INDEX_DB_TEST === '1'
  ? describe
  : describe.skip;

runIntegration('Code-index notification migration integration', () => {
  const prisma = new PrismaService();
  const userId = 'code-index-notification-integration-user';

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: userId,
        email: 'code-index-notification@example.invalid',
        name: 'Code Index Notification',
        accountStatus: AccountStatus.ACTIVE,
      },
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('persists both enum values and enforces delivery deduplication', async () => {
    await prisma.notification.createMany({
      data: [
        {
          userId,
          orgId: 'org-integration',
          type: NotificationType.CODE_INDEX_READY,
          category: NotificationCategory.AI,
          title: 'Ready',
          body: 'Ready',
          dedupeKey: 'code-index-integration-ready',
        },
        {
          userId,
          orgId: 'org-integration',
          type: NotificationType.CODE_INDEX_FAILED,
          category: NotificationCategory.AI,
          title: 'Failed',
          body: 'Failed',
          dedupeKey: 'code-index-integration-failed',
        },
      ],
    });

    await expect(prisma.notification.create({
      data: {
        userId,
        orgId: 'org-integration',
        type: NotificationType.CODE_INDEX_READY,
        category: NotificationCategory.AI,
        title: 'Duplicate',
        body: 'Duplicate',
        dedupeKey: 'code-index-integration-ready',
      },
    })).rejects.toMatchObject<Partial<Prisma.PrismaClientKnownRequestError>>({
      code: 'P2002',
    });
  });
});
