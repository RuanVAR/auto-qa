import { z } from 'zod';

/**
 * Zod schemas for ClickUp plugin install / binding / secrets payloads.
 *
 * Validation runs at every write — install, update, binding upsert. Surface
 * any rejection back to the user via PluginService → BadRequestException.
 */

export const ClickUpInstallConfigSchema = z
  .object({
    /**
     * Workspace (team) id, captured at install time. Optional: if absent, the
     * plugin re-derives via /api/v2/team. Caching here saves a round-trip on
     * every dispatch.
     */
    workspaceId: z.string().optional(),

    /** Cosmetic — used in the UI when the same plugin is installed twice. */
    workspaceName: z.string().optional(),
  })
  .strict();

export type ClickUpInstallConfig = z.infer<typeof ClickUpInstallConfigSchema>;

export const ClickUpSecretsSchema = z
  .object({
    /**
     * ClickUp Personal Access Token (`pk_…`) or OAuth bearer token.
     * Stored encrypted via SecretsService; never logged or returned in any API.
     */
    apiToken: z.string().min(20),
  })
  .strict();

export type ClickUpSecrets = z.infer<typeof ClickUpSecretsSchema>;

/**
 * Per-binding config — feature/module/project bindings supply partial overrides
 * that cascade through effective-config.
 *
 * `targetMode` controls how createIssue places new tickets:
 *   - 'list'    → POST /list/{defaultListId}/task
 *   - 'subtask' → POST /list/{defaultListId}/task with `parent: defaultParentTaskId`
 */
export const ClickUpBindingConfigSchema = z
  .object({
    workspaceId: z.string().optional(),
    spaceId: z.string().optional(),
    folderId: z.string().nullable().optional(),       // null = folderless space
    defaultListId: z.string().optional(),

    targetMode: z.enum(['list', 'subtask']).default('list'),
    defaultParentTaskId: z.string().optional(),

    /** Custom-field id → platform field name mapping (Phase 2 createIssue). */
    customFieldMap: z.record(z.string()).optional(),

    /** Cap recording-attachment size in MB; 1–500 — defaults at the binding level. */
    attachRecordingMaxMb: z.number().int().min(1).max(500).default(50),
  })
  .strict()
  .partial();

export type ClickUpBindingConfig = z.infer<typeof ClickUpBindingConfigSchema>;
