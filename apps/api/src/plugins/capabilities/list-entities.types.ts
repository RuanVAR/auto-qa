/**
 * listEntities — generic browsing endpoint for binding-picker cascades.
 *
 * The frontend calls this to populate dropdowns when `FieldHint.loader` is set.
 * The `kind` is plugin-defined (e.g. ClickUp uses "workspace", "space",
 * "folder", "list"). `parent` carries the previous level's selection so the
 * plugin can scope its query.
 */
export type ListEntitiesInput = {
  kind: string;                                // plugin-defined entity type
  parent?: Record<string, string>;             // upstream selections (workspaceId, spaceId, ...)
  query?: string;                              // typeahead text
  limit?: number;
};

export type ListEntitiesOutput = {
  items: { id: string; label: string; meta?: Record<string, unknown> }[];
  nextCursor?: string;
};
