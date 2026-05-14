import { z } from 'zod';

/**
 * Zod schemas for ClickUp plugin install / binding / secrets payloads.
 *
 * Validation runs at every write — install, update, binding upsert. Surface
 * any rejection back to the user via PluginService → BadRequestException.
 *
 * ─── Binding-config split ───────────────────────────────────────────────────
 *
 * A binding holds two semantically different decisions:
 *
 *   • SCOPE   = where this project lives in ClickUp (workspaceId + spaceId).
 *               One project = one space. This is the answer to "what ClickUp
 *               area corresponds to this project?" — used by doc/AC search to
 *               narrow lookups, and by the bootstrap wizard to know where to
 *               read from.
 *
 *   • ROUTING = where new tickets land by default (folderId, defaultListId,
 *               targetMode, defaultParentTaskId). The "default" matters at
 *               create-time and can be re-pointed per ticket later.
 *
 * On the wire we still store both halves together as one `bindingConfig` JSON
 * blob (no migration needed). Validation/typing/UX keep them separate so the
 * user sees "scope = required, routing = defaults" rather than 6 equal fields.
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

// ── Scope half ────────────────────────────────────────────────────────────
// What part of ClickUp is this project? Drives:
//   • doc/AC search filtering (list-docs.ts reads workspaceId/spaceId)
//   • bootstrap wizard pre-fill ("import features from this space")
//   • open-in-ClickUp deep links
//
// Both fields are nullable here so the Zod parser doesn't reject legacy rows
// during read; the form / save handler enforce "both present" semantically.
export const ClickUpScopeConfigSchema = z
  .object({
    workspaceId: z.string().optional(),
    spaceId: z.string().optional(),
  })
  .strict();

export type ClickUpScopeConfig = z.infer<typeof ClickUpScopeConfigSchema>;

// ── Routing half ──────────────────────────────────────────────────────────
// Where do new tickets default to? Per the binding refactor (Q1=a), the
// project-level form still requires defaultListId at save-time — but the
// user sees it as a *default* under the scope, not as a separate scope pillar.
// Per-ticket overrides are independent of this default.
export const ClickUpRoutingConfigSchema = z
  .object({
    folderId: z.string().nullable().optional(), // null = folderless space
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

export type ClickUpRoutingConfig = z.infer<typeof ClickUpRoutingConfigSchema>;

/**
 * Per-binding config — feature/module/project bindings supply partial overrides
 * that cascade through effective-config. Composed of scope + routing halves;
 * we keep one Zod schema for storage so the existing plugin-service validation
 * pipeline doesn't have to learn about the split.
 *
 * `targetMode` controls how createIssue places new tickets:
 *   - 'list'    → POST /list/{defaultListId}/task
 *   - 'subtask' → POST /list/{defaultListId}/task with `parent: defaultParentTaskId`
 */
export const ClickUpBindingConfigSchema = ClickUpScopeConfigSchema.merge(
  ClickUpRoutingConfigSchema,
).partial();

export type ClickUpBindingConfig = z.infer<typeof ClickUpBindingConfigSchema>;

/**
 * Project-level save guard: scope (workspace + space) must be set together,
 * and the default list must be chosen so create-issue / push-feature don't
 * trip the "no list configured" hard-fail at the moment of action.
 *
 * Lives here (not in the controller) so the same validation runs in tests
 * and the form's pre-save check. Returns null when OK, error message when not.
 */
export function validateProjectBindingForSave(cfg: ClickUpBindingConfig): string | null {
  if (!cfg.workspaceId) return 'Pick a workspace to scope this project to.';
  if (!cfg.spaceId) return 'Pick a space — this is the ClickUp area for the project.';
  if (!cfg.defaultListId) return 'Pick a default list so new tickets have somewhere to land.';
  if (cfg.targetMode === 'subtask' && !cfg.defaultParentTaskId) {
    return 'Subtask mode needs a parent task.';
  }
  return null;
}
