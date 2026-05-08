import type { PluginCtx } from '../../types';
import type { ListEntitiesInput, ListEntitiesOutput } from '../../capabilities';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';
import { PluginPermanentError } from '../../plugin.errors';

/**
 * Powers the cascading binding-form picker.
 *
 * Frontend FieldHints declare `loader: 'listEntities'` and pass the chosen
 * upstream parents in `payload.parent`. We dispatch on `payload.kind`:
 *
 *   workspace  → all teams (PAT scope)
 *   space      → spaces within parent.workspaceId
 *   folder     → folders within parent.spaceId (always includes a synthetic
 *                "(no folder)" entry mapping to folderless lists)
 *   list       → lists in parent.folderId, or folderless lists in parent.spaceId
 *                when folderId is null/'__folderless__'
 *   parent-task→ recent tasks in parent.listId (subtask-mode parent picker)
 *   custom-field → list/{id} → custom fields (Phase 3 createIssue mapping)
 */
export async function listEntities(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<ListEntitiesOutput> {
  const { kind, parent, query, limit } = (payload as ListEntitiesInput) ?? { kind: '' };
  const client = new ClickUpClient(ctx.http);
  const q = (query ?? '').toLowerCase();

  const filterAndLimit = <T extends { label: string }>(rows: T[]): T[] => {
    const filtered = q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;
    return limit ? filtered.slice(0, limit) : filtered;
  };

  switch (kind) {
    case 'workspace': {
      const teams = await client.getTeams();
      return {
        items: filterAndLimit(
          teams.map((t) => ({
            id: t.id,
            label: t.name,
            meta: { color: t.color, avatar: t.avatar },
          })),
        ),
      };
    }

    case 'space': {
      const workspaceId = parent?.workspaceId;
      if (!workspaceId) throw new PluginPermanentError('listEntities space requires parent.workspaceId', 'clickup');
      const spaces = await client.getSpaces(workspaceId);
      return {
        items: filterAndLimit(
          spaces.map((s) => ({
            id: s.id,
            label: s.name,
            meta: { private: s.private, archived: s.archived },
          })),
        ),
      };
    }

    case 'folder': {
      const spaceId = parent?.spaceId;
      if (!spaceId) throw new PluginPermanentError('listEntities folder requires parent.spaceId', 'clickup');
      const folders = await client.getFolders(spaceId);
      // Synthetic "(no folder)" lets the picker reach folderless lists too.
      const items = [
        { id: '__folderless__', label: '(no folder — folderless lists)' },
        ...folders.map((f) => ({
          id: f.id,
          label: f.name,
          meta: { hidden: f.hidden, archived: f.archived, taskCount: f.task_count },
        })),
      ];
      return { items: filterAndLimit(items) };
    }

    case 'list': {
      const folderId = parent?.folderId;
      const spaceId = parent?.spaceId;
      let lists: Awaited<ReturnType<typeof client.getListsInFolder>>;
      if (folderId && folderId !== '__folderless__') {
        lists = await client.getListsInFolder(folderId);
      } else if (spaceId) {
        lists = await client.getFolderlessLists(spaceId);
      } else {
        throw new PluginPermanentError('listEntities list requires parent.folderId or parent.spaceId', 'clickup');
      }
      return {
        items: filterAndLimit(
          lists.map((l) => ({
            id: l.id,
            label: l.name,
            meta: { taskCount: l.task_count, archived: l.archived },
          })),
        ),
      };
    }

    case 'parent-task': {
      // ClickUp doesn't have a "search recent tasks in list" endpoint that
      // accepts a free-text query without a query DSL — so we just fetch the
      // first page of tasks and let the frontend filter client-side.
      const listId = parent?.listId;
      if (!listId) throw new PluginPermanentError('listEntities parent-task requires parent.listId', 'clickup');
      const { data } = await ctx.http.get(`/api/v2/list/${listId}/task`, {
        params: { include_closed: 'false', subtasks: 'false', page: '0' },
      });
      const tasks = ((data as { tasks?: Array<{ id: string; name: string }> }).tasks ?? []).map((t) => ({
        id: t.id,
        label: t.name,
      }));
      return { items: filterAndLimit(tasks) };
    }

    case 'custom-field': {
      const listId = parent?.listId;
      if (!listId) throw new PluginPermanentError('listEntities custom-field requires parent.listId', 'clickup');
      const detail = await client.getList(listId);
      const fields = (detail.custom_fields ?? []).map((f) => ({
        id: f.id,
        label: f.name,
        meta: { type: f.type, typeConfig: f.type_config },
      }));
      return { items: filterAndLimit(fields) };
    }

    case 'list-statuses': {
      // Powers the status mapping grid — list/{id} returns the list's statuses.
      const listId = parent?.listId;
      if (!listId) throw new PluginPermanentError('listEntities list-statuses requires parent.listId', 'clickup');
      const detail = await client.getList(listId);
      return {
        items: detail.statuses.map((s) => ({
          id: s.status,
          label: s.status,
          meta: { type: s.type, color: s.color },
        })),
      };
    }

    default:
      throw new PluginPermanentError(`Unknown listEntities kind: ${kind}`, 'clickup');
  }
}
