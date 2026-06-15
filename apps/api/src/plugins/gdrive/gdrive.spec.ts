import { GdriveInstallConfigSchema, isInScope, isConfigured, type GdriveInstallConfig } from './schemas';
import { allowedParentsQuery } from './scope';
import { isFolderMime, isGoogleNative, FOLDER_MIME } from './gdrive.client';
import { buildConsentUrl, GDRIVE_SCOPES } from './oauth';

// The OAuth helpers read GOOGLE_CLIENT_ID + API_URL at call time.
beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.API_URL = 'https://api.example.test';
});

describe('gdrive install config schema', () => {
  it('accepts entire mode with no folders', () => {
    const r = GdriveInstallConfigSchema.safeParse({ accessMode: 'entire', allowedFolderIds: [] });
    expect(r.success).toBe(true);
  });

  it('accepts folders mode with an empty allow-list (the "unconfigured" state)', () => {
    const r = GdriveInstallConfigSchema.safeParse({ accessMode: 'folders', allowedFolderIds: [] });
    expect(r.success).toBe(true);
  });

  it('accepts folders mode with at least one folder', () => {
    const r = GdriveInstallConfigSchema.safeParse({ accessMode: 'folders', allowedFolderIds: ['f1'] });
    expect(r.success).toBe(true);
  });

  it('isConfigured: false until a base folder is chosen', () => {
    expect(isConfigured({ accessMode: 'folders', allowedFolderIds: [] })).toBe(false);
    expect(isConfigured({ accessMode: 'folders', allowedFolderIds: ['f1'] })).toBe(true);
    expect(isConfigured({ accessMode: 'entire', allowedFolderIds: [] })).toBe(true);
  });

  it('rejects unknown keys (strict)', () => {
    const r = GdriveInstallConfigSchema.safeParse({ accessMode: 'entire', allowedFolderIds: [], bogus: 1 });
    expect(r.success).toBe(false);
  });
});

describe('isInScope (leaf-level allow-list gate)', () => {
  const entire: GdriveInstallConfig = { accessMode: 'entire', allowedFolderIds: [] };
  const folders: GdriveInstallConfig = { accessMode: 'folders', allowedFolderIds: ['A', 'B'] };

  it('allows everything in entire mode', () => {
    expect(isInScope(entire, undefined)).toBe(true);
    expect(isInScope(entire, ['anything'])).toBe(true);
  });

  it('allows a file whose parent is allow-listed', () => {
    expect(isInScope(folders, ['A'])).toBe(true);
    expect(isInScope(folders, ['X', 'B'])).toBe(true);
  });

  it('denies a file with no parents or an out-of-scope parent in folders mode', () => {
    expect(isInScope(folders, undefined)).toBe(false);
    expect(isInScope(folders, [])).toBe(false);
    expect(isInScope(folders, ['X', 'Y'])).toBe(false);
  });
});

describe('allowedParentsQuery', () => {
  it('returns empty in entire mode (no constraint)', () => {
    expect(allowedParentsQuery({ accessMode: 'entire', allowedFolderIds: [] })).toBe('');
  });

  it('builds an OR of "in parents" clauses in folders mode', () => {
    const q = allowedParentsQuery({ accessMode: 'folders', allowedFolderIds: ['A', 'B'] });
    expect(q).toBe("('A' in parents or 'B' in parents)");
  });

  it("escapes single quotes in folder ids", () => {
    const q = allowedParentsQuery({ accessMode: 'folders', allowedFolderIds: ["a'b"] });
    expect(q).toContain("a\\'b");
  });
});

describe('mime helpers', () => {
  it('detects folders', () => {
    expect(isFolderMime(FOLDER_MIME)).toBe(true);
    expect(isFolderMime('application/pdf')).toBe(false);
  });

  it('detects Google-native docs but not folders or binaries', () => {
    expect(isGoogleNative('application/vnd.google-apps.document')).toBe(true);
    expect(isGoogleNative('application/vnd.google-apps.spreadsheet')).toBe(true);
    expect(isGoogleNative(FOLDER_MIME)).toBe(false);
    expect(isGoogleNative('application/pdf')).toBe(false);
    expect(isGoogleNative(undefined)).toBe(false);
  });
});

describe('buildConsentUrl', () => {
  it('requests offline access + forced consent (so a refresh token is issued)', () => {
    const url = new URL(buildConsentUrl('state-abc'));
    const p = url.searchParams;
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('prompt')).toBe('consent');
    expect(p.get('state')).toBe('state-abc');
    expect(p.get('response_type')).toBe('code');
    // Fixed callback URI (no orgId in path) — Google redirect URIs are exact-match.
    expect(p.get('redirect_uri')).toBe('https://api.example.test/api/v1/gdrive/oauth/callback');
    expect(p.get('scope')).toBe(GDRIVE_SCOPES.join(' '));
  });
});
