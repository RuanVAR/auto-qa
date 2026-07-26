import { EnvironmentReleaseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Snapshot the latest successful release before creating a run. */
export async function currentEnvironmentReleaseId(
  prisma: PrismaService,
  environmentId?: string | null,
): Promise<string | null> {
  if (!environmentId) return null;
  const release = await prisma.environmentRelease.findFirst({
    where: {
      environmentId,
      status: EnvironmentReleaseStatus.SUCCESS,
      deletedAt: null,
    },
    select: { id: true },
    orderBy: [{ deployedAt: 'desc' }, { createdAt: 'desc' }],
  });
  return release?.id ?? null;
}
