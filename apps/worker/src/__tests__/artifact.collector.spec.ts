import { ArtifactCollector } from '../collectors/artifact.collector';

// Mock the entire fs module so all properties are configurable jest.fn() stubs.
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  existsSync: jest.fn(),
  statSync: jest.fn(),
  createReadStream: jest.fn(),
}));

import * as fs from 'fs';

const mockPrisma = {
  artifact: {
    create: jest.fn().mockResolvedValue({ id: 'art-1' }),
  },
};

// Typed helpers for the mocked functions
const mkdirSyncMock  = fs.mkdirSync  as jest.Mock;
const existsSyncMock = fs.existsSync as jest.Mock;
const statSyncMock   = fs.statSync   as jest.Mock;

describe('ArtifactCollector', () => {
  let collector: ArtifactCollector;

  beforeEach(() => {
    jest.clearAllMocks();
    existsSyncMock.mockReturnValue(true);
    statSyncMock.mockReturnValue({ size: 12345 } as ReturnType<typeof fs.statSync>);

    collector = new ArtifactCollector(mockPrisma as never, 'run-1', '/tmp/artifacts/runs/run-1');
  });

  it('creates the run directory on instantiation', () => {
    expect(mkdirSyncMock).toHaveBeenCalledWith('/tmp/artifacts/runs/run-1', { recursive: true });
  });

  it('registers an artifact when file exists', async () => {
    const result = await collector.register('SCREENSHOT', 'step-1.png', '/tmp/artifacts/runs/run-1/step-1.png');
    expect(result).toEqual({ id: 'art-1' });
    expect(mockPrisma.artifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: 'run-1',
          type: 'SCREENSHOT',
          filename: 'step-1.png',
          sizeBytes: 12345,
        }),
      }),
    );
  });

  it('skips registration when file does not exist', async () => {
    existsSyncMock.mockReturnValue(false);

    const result = await collector.register('SCREENSHOT', 'missing.png', '/tmp/artifacts/runs/run-1/missing.png');
    expect(result).toBeUndefined();
    expect(mockPrisma.artifact.create).not.toHaveBeenCalled();
  });

  it('exposes runDir publicly', () => {
    expect(collector.runDir).toBe('/tmp/artifacts/runs/run-1');
  });
});
