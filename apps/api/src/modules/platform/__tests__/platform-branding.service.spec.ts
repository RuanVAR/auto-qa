import { Test, TestingModule } from '@nestjs/testing';
import { PlatformBrandingService, PLATFORM_LOGO_KEY, PLATFORM_NAME_KEY } from '../platform-branding.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

const mockPrisma = {
  platformConfig: {
    findMany: jest.fn(),
    upsert: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
};

describe('PlatformBrandingService', () => {
  let service: PlatformBrandingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformBrandingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(PlatformBrandingService);
  });

  it('maps the two config rows into { logoUrl, appName }', async () => {
    mockPrisma.platformConfig.findMany.mockResolvedValue([
      { key: PLATFORM_LOGO_KEY, value: 'https://x/logo.png' },
      { key: PLATFORM_NAME_KEY, value: 'Acme QA' },
    ]);
    expect(await service.get()).toEqual({ logoUrl: 'https://x/logo.png', appName: 'Acme QA' });
  });

  it('returns nulls when nothing is configured', async () => {
    mockPrisma.platformConfig.findMany.mockResolvedValue([]);
    expect(await service.get()).toEqual({ logoUrl: null, appName: null });
  });

  it('caches reads (second get within TTL hits DB once)', async () => {
    mockPrisma.platformConfig.findMany.mockResolvedValue([]);
    await service.get();
    await service.get();
    expect(mockPrisma.platformConfig.findMany).toHaveBeenCalledTimes(1);
  });

  it('upserts a provided logo and busts the cache', async () => {
    mockPrisma.platformConfig.findMany.mockResolvedValue([]);
    await service.get(); // populate cache (1 read)
    await service.set({ logoUrl: 'https://x/new.png' });
    expect(mockPrisma.platformConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: PLATFORM_LOGO_KEY } }),
    );
    // set() returns get() → cache was busted, so findMany ran again (2 total)
    expect(mockPrisma.platformConfig.findMany).toHaveBeenCalledTimes(2);
  });

  it('clears a field (reset to built-in) when set to null', async () => {
    mockPrisma.platformConfig.findMany.mockResolvedValue([]);
    await service.set({ logoUrl: null });
    expect(mockPrisma.platformConfig.deleteMany).toHaveBeenCalledWith({ where: { key: PLATFORM_LOGO_KEY } });
    expect(mockPrisma.platformConfig.upsert).not.toHaveBeenCalled();
  });

  it('leaves untouched fields alone (undefined = no-op)', async () => {
    mockPrisma.platformConfig.findMany.mockResolvedValue([]);
    await service.set({ appName: 'Only Name' });
    expect(mockPrisma.platformConfig.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.platformConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: PLATFORM_NAME_KEY } }),
    );
  });
});
