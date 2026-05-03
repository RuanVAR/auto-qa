# Project Overview Page

Full specification for the project overview page — the stats header, the module listing with search, sort, tag filtering, and group-by-tag view.

Related docs:
- `docs/FEATURE_PLAYER.md` — stats panels, testing view
- `docs/UI_LAYOUT.md` — shell, sidebar, navigation

---

## 1. Current State vs This Spec

**Currently implemented** (`ProjectDetailPage.tsx`):
- 3 stat cards: Test Definitions count, Test Runs count, Environments count
- Two buttons: "Manage Tests", "View Runs"
- No module listing on this page

**This spec adds:**
- Project-level stats using the same pass/fail/skip/outstanding formula
- Full module listing on the project page (replaces navigating away to `/modules`)
- Module tags — assignable labels for grouping and filtering
- Search, sort, filter by tag, and group by tag

---

## 2. Module Tags — Data Model

Tags are free-text string labels stored directly on the `Module` model.

### Schema change

```prisma
model Module {
  id          String    @id @default(uuid())
  name        String
  description String?
  tags        String[]  @default([])   // ← ADD THIS
  order       Int       @default(0)
  isActive    Boolean   @default(true)
  deletedAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  projectId   String
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  features    Feature[]
  @@map("modules")
}
```

Tags are lowercase, trimmed strings (e.g. `"checkout"`, `"auth"`, `"api"`, `"regression"`).

No separate `Tag` model — tags are stored inline. Auto-complete when adding tags is powered by a query that returns all distinct tag values used across modules in the same project:

```
GET /api/v1/projects/:projectId/modules/tags
→ { tags: string[] }   // distinct sorted list of all tags in use
```

### Tag rules

- Max 10 tags per module
- Max 32 chars per tag
- Alphanumeric, hyphens, underscores allowed: `[a-z0-9\-_]+`
- Stored lowercase; input normalised on save
- Empty array = untagged

---

## 3. Project Overview Page Layout

Route: `/projects/:projectId`

```
┌─────────────────────────────────────────────────────────────────────────┐
│  My App                                                                  │
│  E-commerce platform — checkout, auth, product and order flows          │
├──────────┬──────────┬──────────┬──────────┬────────────────────────────┤
│ ✅ Passed│ ❌ Failed│ ⊘ Skipped│ ○ Out-   │  Pass rate                 │
│    42    │    5     │    2     │ standing │  89%  ████████████░         │
│          │          │          │    8     │  Last run 1h ago           │
├──────────┴──────────┴──────────┴──────────┴────────────────────────────┤
│  Quick links:  [Environments (3)]  [Run History]  [Settings]            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Modules (6)                         [+ New Module]                     │
│                                                                          │
│  [ 🔍 Search modules... ]  [ Tag ▼ ]  [ Sort ▼ ]  [ ⊞ Group by tag ]   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Authentication          [auth] [security]          2 features    │   │
│  │ Sign-in, sign-out, OAuth, session management                     │   │
│  │ ✅ 18  ❌ 2  ⊘ 1  ○ 0    Pass rate: 90%   Last run 1h ago       │   │
│  │                                    [Start Testing →]  [Edit ⋯]   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Checkout Flow           [checkout] [payments]      4 features    │   │
│  │ Cart, payment processing, order confirmation, promo codes        │   │
│  │ ✅ 24  ❌ 3  ⊘ 0  ○ 4    Pass rate: 89%   Last run 2h ago       │   │
│  │                                    [Start Testing →]  [Edit ⋯]   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ User Profile            [profile]                 1 feature      │   │
│  │ Account settings and preferences                                 │   │
│  │ ✅ 5   ❌ 0  ⊘ 0  ○ 3    Pass rate: 100%  Last run Yesterday     │   │
│  │                                    [Start Testing →]  [Edit ⋯]   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Project Stats Header

Same four stat cards from `docs/FEATURE_PLAYER.md §1`, aggregated across all modules → all features → all test cases in the project.

**Calculation:** Call `StatsService.computeProjectStats(projectId)` which sums `computeModuleStats()` for all active modules.

Pass rate card also shows:
- Mini progress bar
- `Last run X ago` (most recent completed run across any feature in the project)

Clicking a stat card in the project header does **not** filter the module list — the cards are informational only at this level. (Filtering happens at module level and below.)

**Quick links row** below the stats:
- `[Environments (N)]` → `/projects/:id/environments`
- `[Run History]` → `/projects/:id/runs`  
- `[Settings]` → `/projects/:id/settings`

These are compact text links, not buttons. They sit in a muted row under the stat cards.

---

## 5. Module List Controls

The controls bar sits directly above the module cards:

```
[ 🔍 Search modules... ]  [ Tag ▼ ]  [ Sort ▼ ]  [ ⊞ Group by tag ]  [+ New Module]
```

| Control | Detail |
|---------|--------|
| **Search** | Text input; filters module list in real time (client-side); matches on module name and description; clears with `✕` inside the field |
| **Tag filter** | Multi-select dropdown (see §6) |
| **Sort** | Single-select dropdown (see §7) |
| **Group by tag** | Toggle button; when active changes layout to grouped view (see §8) |
| **New Module** | Opens create module modal (existing behaviour); right-aligned |

Active filter state is shown as:
- Search: the typed text in the input
- Tag filter: each active tag shown as a removable chip inline: `auth ×  payments ×`
- Sort: the label of the active sort option shown in the button: `Sort: Pass rate ↓`

Chips and sort label appear between the controls bar and the module list when any filter is active:

```
Showing 3 of 6 modules  ·  auth ×  payments ×  ·  Clear all
```

---

## 6. Tag Filter Dropdown

```
┌────────────────────────────────┐
│  Filter by tag                 │
│  [ 🔍 Search tags... ]         │
│  ─────────────────────────     │
│  ☑  auth            (2)        │
│  ☐  checkout        (4)        │
│  ☑  payments        (3)        │
│  ☐  profile         (1)        │
│  ☐  regression      (5)        │
│  ☐  security        (2)        │
│  ─────────────────────────     │
│  [ Clear ]       [ Apply ]     │
└────────────────────────────────┘
```

- Tags shown alphabetically with a count of how many modules in the project use that tag
- Search within the dropdown filters the tag list
- Multiple tags can be checked simultaneously
- Filter logic: **OR** — a module is shown if it has **any** of the selected tags
- `[Apply]` closes dropdown and applies filter (or auto-apply on checkbox change — decide per implementation)
- `[Clear]` unchecks all tags

**Empty state in dropdown:** "No tags yet — add tags when editing a module."

---

## 7. Sort Options

Dropdown with single selection. Default: **Manually ordered** (the `order` field on Module, drag-reorder if implemented, otherwise creation order).

| Option | Sort key |
|--------|---------|
| Manually ordered | `module.order ASC` (default) |
| Name A → Z | `module.name ASC` |
| Name Z → A | `module.name DESC` |
| Pass rate (high first) | `stats.passRate DESC NULLS LAST` |
| Pass rate (low first) | `stats.passRate ASC NULLS FIRST` |
| Most features | `module.featureCount DESC` |
| Fewest features | `module.featureCount ASC` |
| Recently updated | `module.updatedAt DESC` |
| Outstanding tests | `stats.outstanding DESC` (surfaces modules needing attention) |
| Never tested | modules with `stats.passRate IS NULL` first |

Sorting is applied client-side (all modules loaded at once for a project — unlikely to exceed hundreds). If a project has > 200 modules, sorting moves server-side via query param.

---

## 8. Module Card

Each module is displayed as a card (not a table row) to have room for the stats strip and tag chips:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Authentication                      [auth] [security]  2 features   │
│  Sign-in, sign-out, OAuth, and session management                    │
│                                                                      │
│  ✅ 18 passed   ❌ 2 failed   ⊘ 1 skipped   ○ 0 outstanding   90%   │
│  Last run 1 hour ago                                                 │
│                                                                      │
│  [▶ Start Testing]          [View Features]       [Edit ⋯]          │
└──────────────────────────────────────────────────────────────────────┘
```

### Card elements

| Element | Detail |
|---------|--------|
| **Module name** | Bold, links to `/modules/:id` (the features list page) |
| **Tag chips** | Inline pills, each clickable to activate that tag as a filter |
| **Feature count** | Muted, right-aligned in the header row |
| **Description** | One line, truncated with ellipsis if > 100 chars; tooltip on hover |
| **Stats strip** | ✅/❌/⊘/○ counts + pass rate %; colour-coded per `FEATURE_PLAYER.md §1` |
| **Last run** | Relative timestamp; "Never tested" in amber if no runs |
| **[▶ Start Testing]** | Navigates to the testing view for the first feature in this module — or if module has multiple features, opens a modal to pick which feature to test |
| **[View Features]** | Navigates to `/modules/:id` |
| **[Edit ⋯]** | Three-dot menu: Edit name/description/tags, Delete |

### Card states

**Never tested:**
```
┌──────────────────────────────────────────────────────────────────────┐
│  New Checkout Feature               [checkout]         0 features    │
│  Not yet set up                                                      │
│                                                                      │
│  ○ No test cases yet · Add features to get started                  │
│                                                                      │
│  [+ Add Feature]                              [Edit ⋯]              │
└──────────────────────────────────────────────────────────────────────┘
```

**All outstanding (features exist, no runs):**
```
  ○ 24 outstanding · Never tested
```

**Failing (any failed tests):**
- Card has a subtle red left border (2px, `border-l-2 border-red-500`)

**All passing:**
- Card has a subtle green left border (2px, `border-l-2 border-green-500`)

---

## 9. Group by Tag View

When `[⊞ Group by tag]` is toggled on, modules are grouped under collapsible tag section headers:

```
┌──────────────────────────────────────────────────────────────────────┐
│  auth  (2 modules)                                             ▼     │
├──────────────────────────────────────────────────────────────────────┤
│  ┌─── Authentication card ────────────────────────────────────────┐  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌─── Session Management card ────────────────────────────────────┐  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  checkout  (3 modules)                                         ▼     │
├──────────────────────────────────────────────────────────────────────┤
│  ┌─── Checkout Flow card ─────────────────────────────────────────┐  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ...                                                                  │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  Untagged  (1 module)                                          ▼     │
└──────────────────────────────────────────────────────────────────────┘
```

### Group by tag behaviour

- Tags sorted alphabetically; **Untagged** group always last
- Each group header shows: tag name (pill) + module count + collapse toggle (▼/►)
- Groups are expanded by default; collapsed state saved to `localStorage` per project per tag
- A module with multiple tags (e.g. `[auth, security]`) appears under **both** the `auth` group and the `security` group
- Search and sort still apply within each group
- If a tag filter is also active, only the matching tags show as groups (tag filter + group by tag work together)

### Group header stats strip

Each group header shows aggregate stats across all modules in that group:

```
auth  (2 modules)    ✅ 26   ❌ 2   ○ 0    Pass rate: 93%
```

---

## 10. Module Create / Edit Modal

The existing Create/Edit modal gains a **Tags** field:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Edit Module                                                   [✕]  │
│                                                                     │
│  Name *                                                             │
│  [Authentication                                               ]    │
│                                                                     │
│  Description                                                        │
│  [Sign-in, sign-out, OAuth, and session management            ]    │
│                                                                     │
│  Tags                                                               │
│  [auth ×] [security ×]  [ + Add tag... ]                           │
│                                                                     │
│  Type a tag and press Enter or comma to add.                        │
│  Suggestions: checkout  payments  regression  api                   │
│  Max 10 tags · 32 chars each · lowercase letters, numbers, - _     │
│                                                                     │
│  [Cancel]                                        [Save Module]      │
└─────────────────────────────────────────────────────────────────────┘
```

**Tags input UX:**
- Type-and-Enter or type-and-comma to add a tag
- Already-added tags shown as removable chips `[tag ×]`
- Suggestions dropdown shows existing tags in the project (from `GET /projects/:id/modules/tags`), filtered by what's typed
- If typed value matches no existing tag, shows `"+ Create tag: 'newtag'"` as the first option
- Duplicate tags silently ignored
- Input normalises to lowercase on submit

---

## 11. API Changes

### Module model — new field

```
PATCH /api/v1/modules/:id
Body: { name?, description?, tags? }
```

```typescript
// UpdateModuleDto addition
@IsOptional()
@IsArray()
@IsString({ each: true })
@ArrayMaxSize(10)
tags?: string[];
```

Tags normalised server-side: `.map(t => t.toLowerCase().trim().replace(/[^a-z0-9\-_]/g, ''))`.

### New endpoints

```
GET  /api/v1/projects/:projectId/modules/tags
     → { tags: string[] }
     Returns distinct sorted tag values from all active modules in the project.
     Used to populate the tag filter dropdown and tag input suggestions.

GET  /api/v1/projects/:projectId/stats
     → ProjectStats { passed, failed, skipped, outstanding, total, passRate, lastRunAt }
     Aggregates StatsService.computeProjectStats(projectId).
     Used by the project overview page stats header.
```

### Module list endpoint — tags filter + sort

The existing `GET /api/v1/projects/:projectId/modules` gains query params:

```
GET /api/v1/projects/:projectId/modules
    ?tags=auth,payments     (comma-separated; OR logic)
    &sort=passRate_desc     (see sort key table in §7)
    &search=checkout        (name/description substring match)
    &includeStats=true      (adds stats fields to each module response)
```

Response with `includeStats=true`:

```typescript
interface ModuleWithStats {
  id:          string;
  name:        string;
  description: string | null;
  tags:        string[];
  order:       number;
  featureCount: number;
  updatedAt:   string;
  stats: {
    passed:      number;
    failed:      number;
    skipped:     number;
    outstanding: number;
    total:       number;
    passRate:    number | null;
    lastRunAt:   string | null;
  };
}
```

---

## 12. Migration

```prisma
// Add tags field to Module
// Migration: add_module_tags
ALTER TABLE modules ADD COLUMN tags TEXT[] DEFAULT '{}';
```

Prisma migration command:
```bash
pnpm db:migrate
```

After migration: existing modules have `tags = []` (empty, untagged). No data backfill needed.

---

## 13. Implementation Notes

### Search is client-side

All modules for a project are fetched in one request (with `?includeStats=true`). Search and sort are applied client-side using `useMemo`:

```typescript
const filtered = useMemo(() => {
  let list = modules;

  if (search.trim()) {
    const q = search.toLowerCase();
    list = list.filter(m =>
      m.name.toLowerCase().includes(q) ||
      (m.description ?? '').toLowerCase().includes(q)
    );
  }

  if (activeTags.length > 0) {
    list = list.filter(m => activeTags.some(t => m.tags.includes(t)));
  }

  return sortModules(list, sortOption);
}, [modules, search, activeTags, sortOption]);
```

For projects with > 200 modules, filtering moves server-side via the query params defined in §11.

### Group by tag rendering

```typescript
const grouped = useMemo(() => {
  if (!groupByTag) return null;

  const map = new Map<string, ModuleWithStats[]>();
  for (const m of filtered) {
    if (m.tags.length === 0) {
      map.set('__untagged__', [...(map.get('__untagged__') ?? []), m]);
    } else {
      for (const tag of m.tags) {
        map.set(tag, [...(map.get(tag) ?? []), m]);
      }
    }
  }

  // Sort groups alphabetically; untagged last
  return [...map.entries()].sort(([a], [b]) => {
    if (a === '__untagged__') return 1;
    if (b === '__untagged__') return -1;
    return a.localeCompare(b);
  });
}, [filtered, groupByTag]);
```

### Stats on ProjectDetailPage

`ProjectDetailPage.tsx` currently fetches `projectsApi.get(projectId)` which returns counts. Add a second parallel fetch:

```typescript
const { data: stats } = useQuery(
  ['project-stats', projectId],
  () => statsApi.getProjectStats(projectId),
);
```

Replace the current 3 count cards with the 4 pass/fail/skip/outstanding stat cards + pass rate card.

---

## 14. Verification Checklist

### Data model

- [ ] `Module.tags` field exists in Prisma schema as `String[] @default([])`
- [ ] Migration runs clean (`pnpm db:migrate`)
- [ ] `PATCH /modules/:id` accepts and saves tags array; normalises to lowercase
- [ ] Creating a module with tags saves them correctly
- [ ] `GET /projects/:id/modules/tags` returns distinct sorted list of all tags in project

### Project overview stats

- [ ] Project stats header shows Passed / Failed / Skipped / Outstanding cards
- [ ] Pass rate card shows percentage and progress bar
- [ ] Last run timestamp shown and is accurate
- [ ] Stats match the sum of all child module stats
- [ ] Quick links (Environments, Run History, Settings) navigate correctly

### Module list

- [ ] All modules for the project shown as cards on project overview page
- [ ] Each card shows: name, tags, feature count, description, stats strip, last run, action buttons
- [ ] Cards with failing tests have red left border; all-passing cards have green left border
- [ ] Empty project: "No modules yet" empty state with "New Module" CTA
- [ ] "Never tested" shown in amber when module has features but no runs
- [ ] `[▶ Start Testing]` navigates to testing view (single feature) or feature picker modal (multiple features)
- [ ] `[View Features]` navigates to module features page

### Search

- [ ] Typing in search filters module cards in real time (no page reload)
- [ ] Matches on module name and description (case insensitive)
- [ ] `✕` clears the search
- [ ] "Showing 2 of 6 modules" count shown when search active

### Tag filter

- [ ] Tag dropdown lists all tags used in the project with module counts
- [ ] Selecting multiple tags shows modules that have **any** of the selected tags (OR logic)
- [ ] Active tags shown as removable chips: `auth ×  payments ×`
- [ ] Removing a chip deactivates that tag filter immediately
- [ ] "Clear all" link removes all active filters (search + tags)
- [ ] Search within tag dropdown filters the tag list

### Sort

- [ ] All 9 sort options available in dropdown
- [ ] Default sort is "Manually ordered"
- [ ] Sort button label updates to show active sort: "Sort: Pass rate ↓"
- [ ] Modules re-order immediately on sort change (client-side)

### Group by tag

- [ ] `[⊞ Group by tag]` toggle switches to grouped layout
- [ ] Groups shown alphabetically; "Untagged" always last
- [ ] Each group header shows tag name + module count + aggregate stats strip
- [ ] Clicking group header collapses/expands the group
- [ ] Collapsed state persists on page refresh (localStorage)
- [ ] Module with two tags appears under both groups
- [ ] Group by tag + tag filter work together: only matching tag groups shown
- [ ] Group by tag + search work together: search applies within each group

### Module create/edit tags

- [ ] Tags input in create/edit modal: type + Enter or comma adds a tag chip
- [ ] Suggestions dropdown shows existing project tags filtered by typed text
- [ ] "Create tag: 'newtag'" option shown when no match
- [ ] Removing a chip removes the tag
- [ ] Duplicate tag silently ignored
- [ ] Max 10 tags enforced with inline error message
- [ ] Tags saved correctly on form submit
- [ ] Tags visible on module card immediately after save (no page reload required)
