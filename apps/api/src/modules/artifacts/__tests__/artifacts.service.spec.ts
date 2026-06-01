import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ArtifactsService, ARTIFACT_STORAGE } from '../artifacts.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Readable } from 'stream';

const mockPrisma = {
  artifact: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
};

// Mock StorageProvider — exists()/getSize()/stream() stand in for any backend.
const mockStorage = {
  upload: jest.fn(),
  uploadFile: jest.fn(),
  stream: jest.fn(async () => Readable.from(['data'])),
  streamRange: jest.fn(async () => Readable.from(['da'])),
  getSize: jest.fn(async () => 1234),
  delete: jest.fn(),
  exists: jest.fn(async () => true),
};

describe('ArtifactsService', () => {
  let service: ArtifactsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArtifactsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ARTIFACT_STORAGE, useValue: mockStorage },
      ],
    }).compile();
    service = module.get<ArtifactsService>(ArtifactsService);
  });

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

  describe('openArtifact — traversal guard + streaming', () => {
    it('throws BadRequestException for path traversal attempt', async () => {
      mockPrisma.artifact.findUnique.mockResolvedValue({
        id: 'art-bad',
        path: '../../../etc/passwd',
        filename: 'passwd',
      });
      await expect(service.openArtifact('art-bad')).rejects.toThrow(BadRequestException);
    });

    it('opens a safe key and exposes stream factories + size', async () => {
      mockPrisma.artifact.findUnique.mockResolvedValue({
        id: 'art-1',
        path: 'runs/run-1/step-1.png',
        filename: 'step-1.png',
        mimeType: 'image/png',
        sizeBytes: 4096,
      });
      const opened = await service.openArtifact('art-1');
      expect(opened.size).toBe(4096); // prefers DB sizeBytes
      expect(opened.mimeType).toBe('image/png');
      expect(mockStorage.exists).toHaveBeenCalledWith('runs/run-1/step-1.png');
      await opened.streamFull();
      expect(mockStorage.stream).toHaveBeenCalledWith('runs/run-1/step-1.png');
    });

    it('throws NotFoundException when the object is missing from storage', async () => {
      mockPrisma.artifact.findUnique.mockResolvedValue({
        id: 'art-1', path: 'runs/run-1/gone.png', filename: 'gone.png',
      });
      mockStorage.exists.mockResolvedValueOnce(false);
      await expect(service.openArtifact('art-1')).rejects.toThrow(NotFoundException);
    });
  });
});
