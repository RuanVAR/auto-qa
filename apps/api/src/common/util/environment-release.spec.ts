import { currentEnvironmentReleaseId } from './environment-release';

describe('currentEnvironmentReleaseId', () => {
  it('returns the latest successful release snapshot for a run', async () => {
    const prisma = {
      environmentRelease: {
        findFirst: jest.fn().mockResolvedValue({ id: 'release-2' }),
      },
    };
    await expect(
      currentEnvironmentReleaseId(prisma as never, 'env-1'),
    ).resolves.toBe('release-2');
    expect(prisma.environmentRelease.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ environmentId: 'env-1', status: 'SUCCESS' }),
      }),
    );
  });

  it('does not query when a run has no environment', async () => {
    const prisma = { environmentRelease: { findFirst: jest.fn() } };
    await expect(currentEnvironmentReleaseId(prisma as never, null)).resolves.toBeNull();
    expect(prisma.environmentRelease.findFirst).not.toHaveBeenCalled();
  });
});
