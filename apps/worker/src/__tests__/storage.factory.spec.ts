import {
  createStorageProvider,
  LocalStorageProvider,
  S3StorageProvider,
  GcsStorageProvider,
  AzureBlobStorageProvider,
} from '@qa-platform/storage';

// Cloud providers lazy-load their SDKs only when a method is called, so simply
// constructing them here never touches the network or requires the SDK.
describe('createStorageProvider', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('defaults to local when unset', () => {
    expect(createStorageProvider({})).toBeInstanceOf(LocalStorageProvider);
  });

  it('returns local for STORAGE_PROVIDER=local', () => {
    expect(createStorageProvider({ STORAGE_PROVIDER: 'local' })).toBeInstanceOf(
      LocalStorageProvider,
    );
  });

  it('falls back to local on an unknown provider', () => {
    expect(createStorageProvider({ STORAGE_PROVIDER: 'dropbox' })).toBeInstanceOf(
      LocalStorageProvider,
    );
    expect(warn).toHaveBeenCalled();
  });

  it('builds S3 when bucket + region are present', () => {
    const p = createStorageProvider({
      STORAGE_PROVIDER: 's3',
      S3_BUCKET: 'b',
      S3_REGION: 'us-east-1',
    });
    expect(p).toBeInstanceOf(S3StorageProvider);
  });

  it('falls back to local when S3 config is incomplete', () => {
    const p = createStorageProvider({ STORAGE_PROVIDER: 's3', S3_BUCKET: 'b' });
    expect(p).toBeInstanceOf(LocalStorageProvider);
    expect(warn).toHaveBeenCalled();
  });

  it('builds GCS when bucket is present', () => {
    const p = createStorageProvider({ STORAGE_PROVIDER: 'gcs', GCS_BUCKET: 'b' });
    expect(p).toBeInstanceOf(GcsStorageProvider);
  });

  it('builds Azure with a connection string', () => {
    const p = createStorageProvider({
      STORAGE_PROVIDER: 'azure',
      AZURE_CONTAINER: 'c',
      AZURE_STORAGE_CONNECTION_STRING: 'x',
    });
    expect(p).toBeInstanceOf(AzureBlobStorageProvider);
  });

  it('falls back to local when Azure credentials are missing', () => {
    const p = createStorageProvider({ STORAGE_PROVIDER: 'azure', AZURE_CONTAINER: 'c' });
    expect(p).toBeInstanceOf(LocalStorageProvider);
  });
});
