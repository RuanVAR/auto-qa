# UI Layout & Navigation

## Navigation Pattern Decision

**Chosen pattern: Top Nav + Collapsible Left Sidebar**

The platform is desktop-first and content-dense with a 5-level hierarchy
(Org → Project → Module → Feature → Test Cases). A Mac-style dock was considered
but ruled out for primary navigation — docks work well for 3–5 flat top-level actions
(mobile, launcher-style apps) but become navigationally opaque for deep hierarchies.
Every comparable SaaS in this category (Linear, GitHub, Jira, Datadog, Sentry,
Vercel) uses top nav + sidebar.

**The "dock feel" the user wanted is preserved** through:
- Sidebar collapses to a 56px icon-only rail (icon + tooltip on hover) — feels like a dock
- Smooth 200ms expand/collapse animation
- Collapse state persisted to `localStorage`
- Active item has a highlighted pill background — same visual language as a dock

---

## Overall Shell Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  TOP NAV                                                             │
│  [≡] [Acme Corp ▼]    [🔍 Search...]         [🔔] [? Help] [👤 JD] │
├──────────────┬───────────────────────────────────────────────────────┤
│              │                                                        │
│  SIDEBAR     │  MAIN CONTENT AREA                                    │
│  (240px      │                                                        │
│  expanded    │  Breadcrumb: Acme Corp / My App / Auth Module          │
│  or 56px     │  ─────────────────────────────────────────────────── │
│  collapsed)  │                                                        │
│              │  [page content]                                        │
│  🏠 Home     │                                                        │
│  📁 Projects │                                                        │
│  ▶ Runs      │                                                        │
│  📊 Analytics│                                                        │
│  🔗 Integrat.│                                                        │
│  ─────────── │                                                        │
│  ⚙ Settings  │                                                        │
│  👥 Users    │                                                        │
│  🛡 Admin    │  (shown only to PLATFORM_ADMIN)                       │
│              │                                                        │
│  [← Collapse]│                                                        │
└──────────────┴───────────────────────────────────────────────────────┘
```

---

## Top Navigation Bar

```
┌──────────────────────────────────────────────────────────────────────┐
│  [≡]  [🏢 Acme Corp ▼]   /   [My App ▼]     [🔍 Search...  ⌘K]     │
│                                              [🔔 3] [?] [👤 JD ▼]   │
└──────────────────────────────────────────────────────────────────────┘
```

| Slot | Content | Behaviour |
|------|---------|-----------|
| **[≡]** | Sidebar toggle | Expand / collapse sidebar |
| **Org switcher** | Current org name + chevron | Dropdown — switch org or create new |
| **/ [Project ▼]** | Active project (optional contextual breadcrumb) | Dropdown to switch project within org |
| **Search ⌘K** | Global search | Opens command palette (see below) |
| **🔔** | Notifications bell + unread count | Dropdown of recent run alerts, selector heals, mentions |
| **?** | Help | Opens docs, shortcuts, changelog |
| **👤 JD ▼** | User avatar + name initials | Dropdown: Profile, Settings, Switch Org, Sign out |

### Org Switcher dropdown

```
┌─────────────────────────────────┐
│  Switch organisation            │
│  ─────────────────────────────  │
│  ✓ Acme Corp          (current) │
│    Globex Inc                   │
│    Initech                      │
│  ─────────────────────────────  │
│  + Create new organisation      │
└─────────────────────────────────┘
```

Clicking an org sets it as the active tenant. All sidebar navigation, projects, runs,
and analytics show only data belonging to that org. The selection is stored server-side
in the session so it persists across tabs and refreshes.

### ⌘K Command Palette

Global fuzzy search — press ⌘K (Mac) or Ctrl+K (Windows/Linux) from anywhere:

```
┌────────────────────────────────────────────────────────────────┐
│  🔍  Search or run a command...                                 │
│  ─────────────────────────────────────────────────────────────  │
│  Recent                                                         │
│  ▶ Login Flow — last run 2h ago              Auth Module        │
│  📁 My App                                   Acme Corp          │
│                                                                 │
│  Results for "login"                                            │
│  🧪 Login Flow                               Auth / My App      │
│  🧪 OAuth Login                              Auth / My App      │
│  📁 Authentication Module                    My App             │
└────────────────────────────────────────────────────────────────┘
```

---

## Left Sidebar — Expanded (240px)

```
┌────────────────────────┐
│  Navigation            │
│  ──────────────────    │
│  🏠  Overview          │  ← org dashboard
│  📁  Projects          │  ← list of all projects in org
│  ▶   Runs              │  ← all recent runs across projects
│  📊  Analytics         │  ← org-wide trend charts
│  🔗  Integrations      │  ← Slack, Jira, Teams, Webhooks
│                        │
│  ────────────────────  │
│  ⚙   Settings          │  ← org settings (name, billing, API keys)
│  👥  Users             │  ← org user management
│  🛡  Platform Admin    │  ← shown only to PLATFORM_ADMIN role
│                        │
│  [← Collapse]          │
└────────────────────────┘
```

## Left Sidebar — Collapsed (56px icon rail)

```
┌──────┐
│  🏠  │  ← tooltip: "Overview"
│  📁  │  ← tooltip: "Projects"
│  ▶   │  ← tooltip: "Runs"
│  📊  │  ← tooltip: "Analytics"
│  🔗  │  ← tooltip: "Integrations"
│      │
│  ──  │
│  ⚙  │
│  👥  │
│  🛡  │
│      │
│  →   │  ← expand
└──────┘
```

### Sidebar — Project sub-navigation

When inside a project, the sidebar expands a second level inline:

```
┌────────────────────────┐
│  📁  Projects          │
│    ▼ My App       ← active project
│       📦 Modules       │
│          Auth          │
│          Checkout      │
│       ▶  Runs          │
│       📊 Analytics     │
│       ⚙  Settings      │
│    ─  Globex Portal    │
│    ─  Internal Tools   │
│                        │
│  [+ New Project]       │
└────────────────────────┘
```

---

## Landing Page — Organisation Overview (Dashboard)

The default page after login / org switch. Shows the health of the entire org at a glance.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Good morning, Jamie 👋                          Acme Corp            │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │  5 Projects  │  │  87% Pass    │  │  3 Failing   │  │  2 Heals │ │
│  │              │  │  rate (7d)   │  │  right now   │  │  today   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘ │
│                                                                       │
│  Projects                                         [ + New Project ]  │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  ┌───────────────────────────────────┐  ┌───────────────────────────┐│
│  │  📁 My App                         │  │  📁 Internal Tools        ││
│  │  4 modules · 12 features           │  │  2 modules · 6 features   ││
│  │  ████████████░░  88% (last 7d)     │  │  ████████░░░░  74%        ││
│  │  Last run: 2h ago  ✅ PASSED       │  │  Last run: 1d ago ❌ FAILED││
│  │  [ Open ]                          │  │  [ Open ]   [ Run Now ]   ││
│  └───────────────────────────────────┘  └───────────────────────────┘│
│                                                                       │
│  ┌───────────────────────────────────┐  ┌───────────────────────────┐│
│  │  📁 Globex Portal                  │  │  📁 API Gateway           ││
│  │  ...                               │  │  ...                      ││
│  └───────────────────────────────────┘  └───────────────────────────┘│
│                                                                       │
│  Recent Activity                                                      │
│  ─────────────────────────────────────────────────────────────────   │
│  ❌ Checkout Flow failed · My App · 45m ago      [ View Run ]        │
│  ✅ Auth Suite passed · My App · 2h ago          [ View Run ]        │
│  ⚠  2 selector heals detected · My App · 2h ago  [ Review ]         │
│  👤 Sarah joined as QA Engineer · 3h ago                             │
└──────────────────────────────────────────────────────────────────────┘
```

### Project card states

| State | Visual |
|-------|--------|
| Last run passed | Green left border, ✅ PASSED badge |
| Last run failed | Red left border, ❌ FAILED badge, "Run Now" CTA |
| Never run | Gray border, "No runs yet" |
| Running now | Pulsing blue border, spinner, "Running..." |

---

## Sidebar Navigation — Contextual Levels

The sidebar shifts context at two levels: **org-level** and **project-level**.

### Org-level (default after login)

Home, Projects, All Runs, Analytics, Integrations, Settings, Users, (Admin)

### Project-level (after opening a project)

A project sub-nav replaces the top section. The org-level items remain below the divider.

```
┌────────────────────────┐
│  ← Back to Projects    │  ← click returns to org overview
│  ─────────────────     │
│  📁 My App             │  ← project name heading
│                        │
│  📦  Modules           │  ← module list within this project
│  ▶   Runs              │  ← project-scoped run history
│  📊  Analytics         │  ← project-scoped analytics
│  🌍  Environments      │  ← project environments config
│  🔗  Integrations      │  ← project-level integration overrides
│  ⚙   Settings          │  ← project settings
│  👥  Members           │  ← project member management (OWNER+ only)
└────────────────────────┘
```

---

## Responsive Behaviour

The platform is desktop-first. On smaller screens:

| Viewport | Sidebar behaviour |
|----------|-----------------|
| ≥ 1280px | Sidebar expanded by default |
| 1024–1279px | Sidebar collapsed to icon rail by default |
| < 1024px | Sidebar hidden; hamburger opens it as an overlay drawer |

---

## Page Transitions

All navigation is client-side (React Router). Page transitions use a subtle 150ms fade.
The active sidebar item updates immediately on click (optimistic nav) — data loads behind a
skeleton state in the content area.

---

## Back Navigation Pattern

Every page in the hierarchy has an explicit **back link** in the page header. `navigate(-1)` is NOT used (unreliable for deep links) — instead every back link points to an explicit parent path.

### Page header layout

Every page with a parent uses this header structure:

```
┌──────────────────────────────────────────────────────────────┐
│  ‹ Parent Name     Current Page Title              [Actions] │
│                    Subtitle / description                    │
└──────────────────────────────────────────────────────────────┘
```

- `‹ Parent Name` — `ChevronLeft` icon + parent page name, styled `text-sm text-muted-foreground hover:text-foreground`, explicit `<Link to={parentPath}>` component
- `Current Page Title` — `text-2xl font-semibold`
- `[Actions]` — right-aligned action buttons

### Breadcrumb strip (deep pages only)

On pages 3+ levels deep (Feature detail, Test Editor, Run detail), a compact breadcrumb strip appears **above** the page title row:

```
My App  /  Auth Module  /  Login Flow
```

- Styled `text-xs text-muted-foreground`
- Each segment except the last is a `<Link>` to that level
- Last segment: `font-medium text-foreground`, not a link

### Back navigation map

| Page | Back button label | Parent path |
|------|------------------|-------------|
| Project detail / Modules | `← Projects` | `/projects` |
| Feature list (FeaturesPage) | `← [Module name]` | `/projects/:id` |
| Feature detail (FeaturePage) | `← [Module name]` | `/projects/:id/modules/:moduleId` |
| Test Editor | `← [Feature name]` | `/projects/:id/modules/:moduleId/features/:featureId` |
| Run detail | `← [Feature name]` | `/projects/:id/modules/:moduleId/features/:featureId` |
| Testing View (full-screen) | `← [Feature name]` (in top action bar) | `/projects/:id/modules/:moduleId/features/:featureId` |

### Implementation component

A shared `BackLink` component in `apps/web/src/components/BackLink.tsx`:

```tsx
interface BackLinkProps {
  label: string;   // e.g. "Auth Module"
  to:    string;   // explicit path, never navigate(-1)
}

export function BackLink({ label, to }: BackLinkProps) {
  return (
    <Link
      to={to}
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}
```

---

## Summary of Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Primary nav pattern | Top bar + left sidebar | 5-level hierarchy needs persistent tree context; dock is for flat/shallow apps |
| "Dock feel" | Collapsible icon rail (56px) | Same visual language, better hierarchy support |
| Org switcher position | Top-left of top bar | GitHub/Vercel convention; always visible, first thing user sees |
| Global search | ⌘K command palette | Faster than sidebar hunting for deep items; industry standard |
| Active project in top bar | Secondary breadcrumb slot | Quick project switching without losing sidebar context |
| Sidebar collapse state | `localStorage` | Persists user preference across sessions |
