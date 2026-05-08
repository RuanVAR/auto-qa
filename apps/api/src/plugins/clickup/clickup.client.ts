import type { AxiosInstance } from 'axios';
import FormData from 'form-data';

/**
 * Thin typed wrapper around the slice of the ClickUp v2 API that Phase 2 uses.
 *
 * The wrapper assumes `http` was built by `buildPluginHttp({ baseURL: 'https://api.clickup.com', authHeader: <PAT> })`
 * — meaning retries, rate-limit, 401/403/429 mapping are already in place.
 * Errors thrown here propagate as PluginError subtypes from the http layer.
 *
 * Phase 2 surface (write methods land in a follow-up commit gated by sandbox):
 *
 *   reads:  getUser, getTeams, getSpaces, getFolders, getLists, getList,
 *           getTask, getTaskComments, getDocs, getDoc
 *   writes: createTask, updateTask, attachToTask, registerWebhook, deregisterWebhook
 *
 * `unknown` return types reflect ClickUp's loosely-typed responses — we
 * extract only the fields we use in the capability handlers.
 */

export type ClickUpUser = {
  id: number;
  username: string;
  email: string;
  initials?: string;
  color?: string;
};

export type ClickUpTeam = {
  id: string;                                 // workspace id (named "team" in API)
  name: string;
  color?: string;
  avatar?: string;
};

export type ClickUpSpace = {
  id: string;
  name: string;
  private: boolean;
  archived: boolean;
  statuses?: ClickUpStatus[];
};

export type ClickUpFolder = {
  id: string;
  name: string;
  hidden: boolean;
  archived: boolean;
  task_count?: string;
};

export type ClickUpList = {
  id: string;
  name: string;
  archived: boolean;
  task_count?: number;
  status?: ClickUpStatus | null;
  folder?: { id: string; name: string; hidden: boolean };
  space?: { id: string; name: string };
  statuses?: ClickUpStatus[];
};

export type ClickUpStatus = {
  id?: string;
  status: string;                              // "to do" | "in progress" | …
  type: 'open' | 'custom' | 'closed' | string;
  color?: string;
  orderindex?: number;
};

export type ClickUpListDetail = ClickUpList & {
  statuses: ClickUpStatus[];
  custom_fields?: Array<{ id: string; name: string; type: string; type_config?: Record<string, unknown> }>;
};

export type ClickUpTask = {
  id: string;
  custom_id?: string | null;
  name: string;
  text_content?: string;
  description?: string;
  markdown_description?: string;
  status: ClickUpStatus;
  url: string;
  date_updated: string;
  list?: { id: string; name: string };
  folder?: { id: string; name: string };
  space?: { id: string };
  assignees?: Array<{ id: number; username: string; profilePicture?: string | null }>;
};

export class ClickUpClient {
  constructor(private readonly http: AxiosInstance) {}

  // ── Reads ───────────────────────────────────────────────────────────────

  async getUser(): Promise<ClickUpUser> {
    const { data } = await this.http.get('/api/v2/user');
    return (data as { user: ClickUpUser }).user;
  }

  async getTeams(): Promise<ClickUpTeam[]> {
    const { data } = await this.http.get('/api/v2/team');
    return (data as { teams: ClickUpTeam[] }).teams;
  }

  async getSpaces(workspaceId: string): Promise<ClickUpSpace[]> {
    const { data } = await this.http.get(`/api/v2/team/${workspaceId}/space`, {
      params: { archived: 'false' },
    });
    return (data as { spaces: ClickUpSpace[] }).spaces;
  }

  async getFolders(spaceId: string): Promise<ClickUpFolder[]> {
    const { data } = await this.http.get(`/api/v2/space/${spaceId}/folder`, {
      params: { archived: 'false' },
    });
    return (data as { folders: ClickUpFolder[] }).folders;
  }

  async getListsInFolder(folderId: string): Promise<ClickUpList[]> {
    const { data } = await this.http.get(`/api/v2/folder/${folderId}/list`, {
      params: { archived: 'false' },
    });
    return (data as { lists: ClickUpList[] }).lists;
  }

  async getFolderlessLists(spaceId: string): Promise<ClickUpList[]> {
    const { data } = await this.http.get(`/api/v2/space/${spaceId}/list`, {
      params: { archived: 'false' },
    });
    return (data as { lists: ClickUpList[] }).lists;
  }

  async getList(listId: string): Promise<ClickUpListDetail> {
    const { data } = await this.http.get(`/api/v2/list/${listId}`);
    return data as ClickUpListDetail;
  }

  async getTask(taskId: string, opts?: { includeMarkdown?: boolean; customTaskIds?: boolean; teamId?: string; includeSubtasks?: boolean }): Promise<ClickUpTask & { subtasks?: ClickUpTask[] }> {
    const params: Record<string, string> = {};
    if (opts?.includeMarkdown) params.include_markdown_description = 'true';
    if (opts?.includeSubtasks) params.include_subtasks = 'true';
    if (opts?.customTaskIds && opts.teamId) {
      params.custom_task_ids = 'true';
      params.team_id = opts.teamId;
    }
    const { data } = await this.http.get(`/api/v2/task/${taskId}`, { params });
    return data as ClickUpTask & { subtasks?: ClickUpTask[] };
  }

  async getTaskComments(taskId: string): Promise<Array<{ id: string; comment_text: string; user: { username: string }; date: string }>> {
    const { data } = await this.http.get(`/api/v2/task/${taskId}/comment`);
    return (data as { comments: Array<{ id: string; comment_text: string; user: { username: string }; date: string }> }).comments;
  }

  // ── Writes ──────────────────────────────────────────────────────────────
  // All writes are gated by ClickUpWriteGuard at the capability layer; the
  // client itself doesn't know about that — it just speaks to the API.

  async createTask(
    listId: string,
    body: {
      name: string;
      description?: string;
      markdown_description?: string;
      priority?: 1 | 2 | 3 | 4;                  // 1 urgent — 4 low
      tags?: string[];
      parent?: string;                            // subtask mode
      custom_fields?: Array<{ id: string; value: unknown }>;
    },
  ): Promise<ClickUpTask> {
    const { data } = await this.http.post(`/api/v2/list/${listId}/task`, body);
    return data as ClickUpTask;
  }

  async updateTask(
    taskId: string,
    patch: {
      status?: string;
      description?: string;
      markdown_description?: string;
    },
    opts?: { customTaskIds?: boolean; teamId?: string },
  ): Promise<ClickUpTask> {
    const params: Record<string, string> = {};
    if (opts?.customTaskIds && opts.teamId) {
      params.custom_task_ids = 'true';
      params.team_id = opts.teamId;
    }
    const { data } = await this.http.put(`/api/v2/task/${taskId}`, patch, { params });
    return data as ClickUpTask;
  }

  /**
   * Attach a file. Caller passes a Buffer + filename — the actual multipart
   * boundary is built by `form-data`. ClickUp's attachment endpoint is
   * idiosyncratic: the field name MUST be `attachment`.
   */
  async attachToTask(
    taskId: string,
    file: { buffer: Buffer; filename: string; contentType?: string },
  ): Promise<{ id: string; url: string; title: string; type: number }> {
    const fd = new FormData();
    fd.append('attachment', file.buffer, { filename: file.filename, contentType: file.contentType });
    const { data } = await this.http.post(`/api/v2/task/${taskId}/attachment`, fd, {
      headers: fd.getHeaders(),
    });
    return data as { id: string; url: string; title: string; type: number };
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  async registerWebhook(
    workspaceId: string,
    body: { endpoint: string; events: string[] },
  ): Promise<{ id: string; webhook: { id: string; secret: string } }> {
    const { data } = await this.http.post(`/api/v2/team/${workspaceId}/webhook`, body);
    return data as { id: string; webhook: { id: string; secret: string } };
  }

  async deregisterWebhook(webhookId: string): Promise<void> {
    await this.http.delete(`/api/v2/webhook/${webhookId}`);
  }

  // ── Docs (v3 — workspace-scoped) ────────────────────────────────────────

  /**
   * NOTE on `query`: ClickUp's v3 listDocs endpoint silently ignores any
   * search-string parameter (we tried `q`, `name`, none filter). We pull a
   * larger page and let the caller filter client-side. `parent_id` +
   * `parent_type` DO work as filters and are the right way to scope the
   * search to a space / folder / list.
   *
   * parent_type codes (per ClickUp): 1=List, 2=Folder, 3=Task, 4=Space, 5=Workspace.
   */
  async listDocs(
    workspaceId: string,
    opts?: { limit?: number; cursor?: string; parentId?: string; parentType?: number },
  ): Promise<{ docs: Array<{ id: string; name: string; date_updated?: number; date_created?: number; description?: string; parent?: { id: string; type: number } }>; next_cursor?: string }> {
    const params: Record<string, string> = {};
    if (opts?.limit) params.limit = String(opts.limit);
    if (opts?.cursor) params.cursor = opts.cursor;
    if (opts?.parentId) params.parent_id = opts.parentId;
    if (opts?.parentType !== undefined) params.parent_type = String(opts.parentType);
    const { data } = await this.http.get(`/api/v3/workspaces/${workspaceId}/docs`, { params });
    return data as { docs: Array<{ id: string; name: string; date_updated?: number; date_created?: number; description?: string; parent?: { id: string; type: number } }>; next_cursor?: string };
  }

  async getDoc(workspaceId: string, docId: string): Promise<{ id: string; name: string; date_updated?: number; parent?: { id: string; type: number } }> {
    const { data } = await this.http.get(`/api/v3/workspaces/${workspaceId}/docs/${docId}`);
    return data as { id: string; name: string; date_updated?: number; parent?: { id: string; type: number } };
  }

  /**
   * Flat list of pages (id + name + parent_page_id for tree reconstruction).
   * Cheap — does not return content. Use getDocPagesWithContent for the
   * full pull or getDocPage for one specific page.
   */
  async getDocPageListing(workspaceId: string, docId: string): Promise<Array<{ id: string; name: string; parent_page_id: string | null }>> {
    const { data } = await this.http.get(`/api/v3/workspaces/${workspaceId}/docs/${docId}/pageListing`);
    if (Array.isArray(data)) return data as Array<{ id: string; name: string; parent_page_id: string | null }>;
    return [];
  }

  async getDocPagesWithContent(workspaceId: string, docId: string): Promise<Array<{ id: string; name: string; parent_page_id: string | null; content?: string }>> {
    const { data } = await this.http.get(`/api/v3/workspaces/${workspaceId}/docs/${docId}/pages`, {
      params: { max_page_depth: '-1', content_format: 'text/md' },
    });
    if (Array.isArray(data)) return data as Array<{ id: string; name: string; parent_page_id: string | null; content?: string }>;
    return [];
  }

  async getDocPage(workspaceId: string, docId: string, pageId: string): Promise<{ id: string; name: string; parent_page_id: string | null; content: string }> {
    const { data } = await this.http.get(`/api/v3/workspaces/${workspaceId}/docs/${docId}/pages/${pageId}`, {
      params: { content_format: 'text/md' },
    });
    return data as { id: string; name: string; parent_page_id: string | null; content: string };
  }
}
