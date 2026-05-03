# Global Search

> **Status:** Planned (Phase 10)
> **Depends on:** Phase 6 (Multi-Tenancy / RBAC), Phase 9 (BDD Tags, Requirements)

---

## Overview

Global search provides a unified way to find any entity a user has access to — across projects, modules, features, test cases, run history, environments, team members, requirements, and BDD tags. It surfaces in two places:

1. **⌘K Command Palette** — modal, instant, keyboard-driven. Available from anywhere in the app.
2. **`/search` page** — full-results page with sidebar filters, pagination, and deep linking.

Both surfaces are RBAC-aware: results are strictly scoped to the user's active org and the projects they are a member of.

---

## Search Backend

### Option A — PostgreSQL Full-Text Search (Default)

Zero additional infrastructure. Uses PostgreSQL's built-in `tsvector` / `tsquery` full-text search with `GIN` indexes.

**Pros:** No extra service, works with existing Docker Compose stack, good enough for most team sizes.
**Cons:** Less fuzzy (no typo tolerance), no relevance tuning, slower on very large datasets.

**When to upgrade:** Switch to Meilisearch when the platform has >100k searchable documents or when users report poor relevance.

### Option B — Meilisearch (Optional)

Opt-in via `SEARCH_BACKEND=meilisearch` env var. Adds a `meilisearch` container to Docker Compose.

**Pros:** Typo tolerance, advanced relevance ranking, faceted filters, sub-50ms response times.
**Cons:** Additional service to operate, ~200MB RAM baseline.

A `SearchService` abstraction wraps both backends — the rest of the platform does not know which is active.

---

## Searchable Entities

| Entity | Fields Indexed | Breadcrumb | Deep Link |
|--------|---------------|------------|-----------|
| `Project` | name, description, slug | Org | `/projects/:id` |
| `Module` | name, description | Org / Project | `/projects/:id/modules/:id` |
| `Feature` | name, description | Org / Project / Module | `/projects/:id/modules/:mid/features/:id` |
| `TestDefinition` | name, description, step descriptions, step selectors | Org / Project / Module / Feature | `/projects/:id/tests/:id/edit` |
| `TestRun` | error messages, AI summary | Org / Project / Feature | `/runs/:id` |
| `Environment` | name, baseUrl | Org / Project | `/projects/:id/environments` |
| `OrgMember` | name, email | Org | `/settings/members` |
| `Requirement` (Phase 9) | title, description, externalId | Org / Project | `/projects/:id/requirements/:id` |
| BDD tag (Phase 9) | tag value | Org / Project | `/search?q=@tagname&type=tag` |

---

## RBAC Scoping

All search results are filtered server-side:

1. **Org scope** — only entities in the user's active org are returned
2. **Project scope** — for Project, Module, Feature, TestDefinition, TestRun: user must be a member of that project (any role)
3. **Admin scope** — OrgMember results only shown to ORG_ADMIN and PLATFORM_ADMIN

No client-side filtering — the query itself applies the RBAC filter via joined `ProjectMember` and `OrgMember` tables.

```sql
-- Example: search TestDefinitions the user can access
SELECT td.id, td.name, td.description, ts_rank(td.search_vector, query) AS rank
FROM "TestDefinition" td
JOIN "Feature" f ON td."featureId" = f.id
JOIN "Module" m ON f."moduleId" = m.id
JOIN "Project" p ON m."projectId" = p.id
JOIN "ProjectMember" pm ON p.id = pm."projectId" AND pm."userId" = :userId
WHERE p."orgId" = :orgId
  AND td."deletedAt" IS NULL
  AND td.search_vector @@ plainto_tsquery(:query)
ORDER BY rank DESC
LIMIT :limit
OFFSET :offset
```

---

## API

### `GET /search`

Unified search endpoint.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | required | Search query (min 2 chars) |
| `types` | csv | all | Filter: `project,module,feature,test,run,environment,member,requirement,tag` |
| `projectId` | uuid | — | Scope to a specific project |
| `limit` | int | 20 | Results per page (max 50) |
| `offset` | int | 0 | Pagination offset |

**Response:**

```typescript
interface SearchResponse {
  results: SearchResult[];
  totalCount: number;
  breakdown: Record<SearchEntityType, number>; // count per type
  query: string;
  durationMs: number;
}

interface SearchResult {
  id: string;
  type: SearchEntityType;
  title: string;         // primary text (entity name)
  subtitle: string;      // secondary text (description, URL, email)
  breadcrumb: string[];  // ['Acme Corp', 'My App', 'Auth Module']
  url: string;           // deep link path
  score: number;         // relevance score 0-1
  highlight: {           // matched text with <mark> tags
    title?: string;
    subtitle?: string;
    body?: string;
  };
  meta: Record<string, unknown>; // type-specific extra data
}
```

### `GET /search/recent`

Returns the last 10 entities the user navigated to. Stored as a Redis list per user (`search:recent:{userId}`).

### `GET /search/actions`

Command-style results for the ⌘K action list (e.g. "Run Feature → Auth Login Flow", "Create test in Auth Module").

---

## ⌘K Command Palette (Upgraded)

Replaces the basic Phase 6.7 palette with a full search-backed version.

### Layout

```
┌────────────────────────────────────────────────────────────────┐
│  🔍  Search everything...                            ⌘K / Esc  │
│  ─────────────────────────────────────────────────────────────  │
│  [All] [Tests] [Features] [Runs] [Members]                      │
│  ─────────────────────────────────────────────────────────────  │
│  Recent                                                         │
│  ▶  Login Flow — last run 2h ago            Auth / My App       │
│  📁  My App                                  Acme Corp          │
│  ─────────────────────────────────────────────────────────────  │
│  Quick Actions                                                   │
│  ⚡  Run "Auth Module" tests                                     │
│  ⚡  Create test in "Auth Module"                                │
│  ─────────────────────────────────────────────────────────────  │
│  Results for "login"                                             │
│  🧪  Login Flow                              Auth / My App ✓    │
│  🧪  OAuth Login                             Auth / My App ✓    │
│  📁  Authentication Module                   My App             │
│  ▶  Run #142 — Login Flow                   Failed · 2h ago     │
│  ─────────────────────────────────────────────────────────────  │
│  See all 14 results →                                           │
└────────────────────────────────────────────────────────────────┘
```

### Behaviour

| State | What Shows |
|-------|-----------|
| Empty input | Recent items + Quick Action shortcuts |
| 1 char | Recent items + Quick Action shortcuts (no API call) |
| 2+ chars | Debounced (150ms) API call, results grouped by type |
| Loading | Skeleton rows while fetching |
| No results | "No results for X" + suggestions |

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move selection |
| `Enter` | Navigate to selected result |
| `Tab` | Switch between type filter tabs |
| `Escape` | Close palette |
| `⌘K` / `Ctrl+K` | Open / focus input |

---

## `/search` Page

Dedicated results page for deep-dive searching with filters.

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Search bar pre-filled]                       [Search]     │
├──────────────┬──────────────────────────────────────────────┤
│  Filters     │  14 results for "login"   [List] [Grouped]   │
│              │  ─────────────────────────────────────────── │
│  Type        │  🧪 Login Flow                               │
│  ☑ Tests     │     Auth / My App / Auth Module              │
│  ☑ Features  │     Last edited: 2h ago · 4 steps           │
│  ☑ Modules   │     "...When I enter my <mark>login</mark>   │
│  ☑ Projects  │      credentials and click..."               │
│  ☑ Runs      │  ─────────────────────────────────────────── │
│  ─────────── │  🧪 OAuth Login                              │
│  Project     │     Auth / My App / Auth Module              │
│  [Dropdown]  │     ...                                      │
│  ─────────── │  ─────────────────────────────────────────── │
│  Date range  │  📁 Authentication Module                    │
│  [From/To]   │     My App                                   │
│  ─────────── │     ...                                      │
│  Status      │                                              │
│  [Dropdown]  │  ← 1  2  3  →                                │
└──────────────┴──────────────────────────────────────────────┘
```

---

## PostgreSQL Implementation Details

### `tsvector` generated columns

```prisma
// Example on TestDefinition
model TestDefinition {
  // ... existing fields ...
  searchVector Unsupported("tsvector")?

  @@index([searchVector], type: Gin, name: "test_definition_search_idx")
}
```

```sql
-- Generated column (PostgreSQL 12+)
ALTER TABLE "TestDefinition"
ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B')
) STORED;

CREATE INDEX test_definition_search_idx ON "TestDefinition" USING GIN(search_vector);
```

Step descriptions are stored as JSON — they are extracted and concatenated at search time rather than in the generated column (JSON → text extraction in the query).

---

## Meilisearch Implementation (Optional)

When `SEARCH_BACKEND=meilisearch`:

- `SearchIndexerService` listens to Prisma middleware events (create/update/delete)
- On change: upserts document to the correct Meilisearch index
- Documents are structured as flat objects with all searchable text fields
- RBAC filtering: Meilisearch does not enforce RBAC — documents are stored with `orgId` and `projectId`, and the query always applies these as filters
- Index settings: configure searchable attributes, sortable attributes, and filterable attributes per entity type
