import { ArtifactCollector } from '../collectors/artifact.collector';

// Mock fs so register() doesn't touch the disk. promises.unlink is a no-op stub.
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  existsSync: jest.fn(),
  statSync: jest.fn(),
  createReadStream: jest.fn(),
  promises: { unlink: jest.fn().mockResolvedValue(undefined) },
}));

import * as fs from 'fs';

const mockPrisma = {
  artifact: {
    create: jest.fn().mockResolvedValue({ id: 'art-1' }),
  },
};

// Stand-in StorageProvider — we only assert uploadFile is called with the key.
const mockStorage = {
  upload: jest.fn(),
  uploadFile: jest.fn().mockResolvedValue(undefined),
  stream: jest.fn(),
  streamRange: jest.fn(),
  getSize: jest.fn(),
  delete: jest.fn(),
  exists: jest.fn(),
};

const mkdirSyncMock = fs.mkdirSync as jest.Mock;
const existsSyncMock = fs.existsSync as jest.Mock;
const statSyncMock = fs.statSync as jest.Mock;
const unlinkMock = (fs.promises.unlink as unknown) as jest.Mock;

describe('ArtifactCollector', () => {
  let collector: ArtifactCollector;
  const RUN_DIR = '/tmp/qa-run-artifacts/run-1';

  beforeEach(() => {
    jest.clearAllMocks();
    existsSyncMock.mockReturnValue(true);
    statSyncMock.mockReturnValue({ size: 12345 } as ReturnType<typeof fs.statSync>);
    collector = new ArtifactCollector(mockPrisma as never, 'run-1', RUN_DIR, mockStorage as never);
  });

  it('creates the run directory on instantiation', () => {
    expect(mkdirSyncMock).toHaveBeenCalledWith(RUN_DIR, { recursive: true });
  });

  it('uploads via the storage provider then records the storage key', async () => {
    const fullPath = `${RUN_DIR}/step-1.png`;
    const result = await collector.register('SCREENSHOT', 'step-1.png', fullPath);

    expect(result).toEqual({ id: 'art-1' });
    // Uploaded under the stable key, from the local staging path.
    expect(mockStorage.uploadFile).toHaveBeenCalledWith(
      'runs/run-1/step-1.png',
      fullPath,
      'image/png',
    );
    // DB row stores the KEY (not the local temp path).
    expect(mockPrisma.artifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: 'run-1',
          type: 'SCREENSHOT',
          filename: 'step-1.png',
          path: 'runs/run-1/step-1.png',
          mimeType: 'image/png',
          sizeBytes: 12345,
        }),
      }),
    );
    // Local staging copy is removed after upload.
    expect(unlinkMock).toHaveBeenCalledWith(fullPath);
  });

  it('skips registration when file does not exist', async () => {
    existsSyncMock.mockReturnValue(false);
    const result = await collector.register('SCREENSHOT', 'missing.png', `${RUN_DIR}/missing.png`);
    expect(result).toBeUndefined();
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
    expect(mockPrisma.artifact.create).not.toHaveBeenCalled();
  });

  it('exposes runDir publicly', () => {
    expect(collector.runDir).toBe(RUN_DIR);
  });
});
