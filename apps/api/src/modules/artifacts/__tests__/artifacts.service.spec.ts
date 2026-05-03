import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArtifactsService } from '../artifacts.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import * as fs from 'fs';

const mockPrisma = {
  artifact: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
};

const mockConfig = {
  get: jest.fn((key: string, def?: string) => {
    if (key === 'ARTIFACT_STORAGE_PATH') return '/app/artifacts';
    return def;
  }),
};

describe('ArtifactsService', () => {
  let service: ArtifactsService;
  let mkdirSyncSpy: jest.SpyInstance;
  let existsSyncSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    mkdirSyncSpy  = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArtifactsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<ArtifactsService>(ArtifactsService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('findOne', () => {
    it('returns artifact when found', async () => {
      const artifact = { id: 'art-1', runId: 'run-1', type: 'SCREENSHOT', filename: 'step-1.png', path: 'runs/run-1/step-1.png' };
      mockPrisma.artifact.findUnique.mockResolvedValue(artifact);
      const result = await service.findOne('art-1');
      expect(result.id).toBe('art-1');
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.artifact.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFilePath — directory traversal guard', () => {
    it('throws BadRequestException for path traversal attempt', async () => {
      mockPrisma.artifact.findUnique.mockResolvedValue({
        id: 'art-bad',
        path: '../../../etc/passwd',
      });

      await expect(service.getFilePath('art-bad')).rejects.toThrow(BadRequestException);
    });

    it('resolves a safe path within storage dir', async () => {
      mockPrisma.artifact.findUnique.mockResolvedValue({
        id: 'art-1',
        path: 'runs/run-1/step-1.png',
      });

      const result = await service.getFilePath('art-1');
      expect(result).toContain('/app/artifacts');
      expect(result).not.toContain('..');
    });
  });
});
