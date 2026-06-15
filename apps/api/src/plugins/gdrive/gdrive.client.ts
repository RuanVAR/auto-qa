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
};

const FILE_FIELDS = 'id,name,mimeType,parents,webViewLink,modifiedTime,iconLink,size';

export class GoogleDriveClient {
  constructor(private readonly http: AxiosInstance) {}

  /** about.get — cheapest authenticated call, used for the healthcheck. */
  async about(): Promise<{ user?: { emailAddress?: string; displayName?: string } }> {
    const res = await this.http.get('/drive/v3/about', { params: { fields: 'user(emailAddress,displayName)' } });
    return res.data;
  }

  /** List files matching a Drive query string `q`. Caller builds `q`. */
  async listFiles(opts: {
    q: string;
    pageToken?: string;
    pageSize?: number;
    orderBy?: string;
  }): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
    const res = await this.http.get('/drive/v3/files', {
      params: {
        q: opts.q,
        pageToken: opts.pageToken,
        pageSize: opts.pageSize ?? 50,
        orderBy: opts.orderBy ?? 'folder,name',
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        // Surface files in shared drives too, not just My Drive.
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: 'allDrives',
        spaces: 'drive',
      },
    });
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
