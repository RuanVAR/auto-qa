import type { AxiosInstance } from 'axios';

/**
 * Thin typed wrapper over the slice of the Google Drive v3 API the plugin uses.
 *
 * Assumes `http` was built by `buildPluginHttp({ baseURL: 'https://www.googleapis.com',
 * authHeader: 'Bearer <access-token>' })` — so retries, rate-limit, and
 * 401/403 → PluginAuthError are already wired. Export + media downloads live
 * under the same host (`/drive/v3/files/{id}/export`, `?alt=media`), so one
 * baseURL covers everything.
 */

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Google-native types that have no binary bytes — they must be EXPORTED. */
export const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  webViewLink?: string;
  modifiedTime?: string;
  iconLink?: string;
  size?: string;
  /** Set when the file lives in a shared drive — its drive's id. */
  driveId?: string;
};

export type SharedDrive = { id: string; name: string };

const FILE_FIELDS = 'id,name,mimeType,parents,webViewLink,modifiedTime,iconLink,size,driveId';

export class GoogleDriveClient {
  constructor(private readonly http: AxiosInstance) {}

  /** about.get — cheapest authenticated call, used for the healthcheck. */
  async about(): Promise<{ user?: { emailAddress?: string; displayName?: string } }> {
    const res = await this.http.get('/drive/v3/about', { params: { fields: 'user(emailAddress,displayName)' } });
    return res.data;
  }

  /** List the shared drives the connected account is a member of. */
  async listDrives(): Promise<SharedDrive[]> {
    const res = await this.http.get('/drive/v3/drives', {
      params: { pageSize: 100, fields: 'drives(id,name)' },
    });
    return (res.data?.drives ?? []) as SharedDrive[];
  }

  /**
   * List files matching a Drive query string `q`. Caller builds `q`.
   *
   * corpora handling (a Drive-API minefield):
   *   - `driveId` set      → scope to that shared drive (corpora='drive').
   *   - `corpora:'allDrives'` → global search across My Drive + shared drives.
   *     Works for a name/`q` search, but DO NOT use it for a
   *     `'<folderId>' in parents` traversal — it returns nothing for My Drive
   *     subfolders.
   *   - neither             → default corpora ('user'), which traverses My
   *     Drive (incl. subfolders) correctly.
   * `supportsAllDrives` + `includeItemsFromAllDrives` are always on so
   * shared-drive items the account can reach are visible.
   */
  async listFiles(opts: {
    q: string;
    pageToken?: string;
    pageSize?: number;
    orderBy?: string;
    corpora?: 'allDrives';
    driveId?: string;
  }): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
    const params: Record<string, unknown> = {
      q: opts.q,
      pageToken: opts.pageToken,
      pageSize: opts.pageSize ?? 50,
      orderBy: opts.orderBy ?? 'folder,name',
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      spaces: 'drive',
    };
    if (opts.driveId) {
      params.corpora = 'drive';
      params.driveId = opts.driveId;
    } else if (opts.corpora) {
      params.corpora = opts.corpora;
    }
    const res = await this.http.get('/drive/v3/files', { params });
    return res.data;
  }

  /** Metadata for one file (used to validate scope + pick a render path). */
  async getFile(id: string): Promise<DriveFile> {
    const res = await this.http.get(`/drive/v3/files/${encodeURIComponent(id)}`, {
      params: { fields: FILE_FIELDS, supportsAllDrives: true },
    });
    return res.data;
  }

  /** Export a Google-native doc (Doc/Sheet/Slide) to the given mime, as text. */
  async exportFile(id: string, exportMime: string): Promise<string> {
    const res = await this.http.get(`/drive/v3/files/${encodeURIComponent(id)}/export`, {
      params: { mimeType: exportMime },
      responseType: 'text',
      // Big HTML exports shouldn't be JSON-parsed; keep as a string.
      transformResponse: [(d) => d],
    });
    return typeof res.data === 'string' ? res.data : String(res.data ?? '');
  }

  /** Download raw bytes for a binary file (PDF, image, …). */
  async downloadMedia(id: string): Promise<{ buffer: Buffer; contentType: string }> {
    const res = await this.http.get(`/drive/v3/files/${encodeURIComponent(id)}`, {
      params: { alt: 'media', supportsAllDrives: true },
      responseType: 'arraybuffer',
    });
    const contentType = (res.headers?.['content-type'] as string) ?? 'application/octet-stream';
    return { buffer: Buffer.from(res.data as ArrayBuffer), contentType };
  }
}

export function isFolderMime(mime: string | undefined): boolean {
  return mime === FOLDER_MIME;
}
export function isGoogleNative(mime: string | undefined): boolean {
  return !!mime && mime.startsWith(GOOGLE_NATIVE_PREFIX) && mime !== FOLDER_MIME;
}
