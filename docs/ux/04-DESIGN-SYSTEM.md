# 04 — Design system and consistency

---

## 1. Current state

Hand-rolled component set in `apps/web/src/components/ui/` — no shadcn, no
headless library:

`Badge · BulkActionBar · Button · Card · DataTable · EmptyState · ErrorBoundary ·
ListSearchSort · MetricInfo · MiniRing · Modal · RunStatusBadge · Spinner ·
StatCard · Table · Tooltip`

That is a reasonable foundation. The problem is not the components — it is that
large parts of the application do not use them.

### Theming
Dark-first, via CSS custom properties (`--text-primary`, `--text-muted`,
`--accent-rgb`, `--accent-400`), applied through inline `style` objects with
`rgba()` literals rather than Tailwind classes.

Workable, but it means the palette is **enforced by convention only**. Nothing
stops a component hardcoding `#7c3aed` or `text-gray-900`, and several do.

---

## 2. The light-mode problem `[ ]` M ⚠️ most visible defect

These screens are light-mode Tailwind (`text-gray-900`, `bg-white`, `bg-gray-50`,
`hover:bg-gray-50`) inside an otherwise dark, glassmorphic application:

| Screen | Location |
|---|---|
| Run detail | `pages/runs/RunDetailPage.tsx:139-470` — the whole page |
| AI page | `pages/ai/AiPage.tsx` |
| API/SHELL editor pane | `pages/tests/TestEditorPage.tsx:1012-1042` |
| Pipelines panel | `pages/runs/PipelinesPanel.tsx` |
| Schedules panel | `pages/runs/SchedulesPanel.tsx` |
| Test run detail heading | `pages/runs/TestRunDetailPage.tsx:110` |

**Run detail is the worst of these**, because it is one of the most-visited
screens in the product — it is where people land from a failure notification.

These do not read as a stylistic choice. They read as **unfinished**, and they sit
on exactly the screens a user reaches when something has gone wrong, which is the
moment their confidence is already lowest.

### Fix
Convert to the dark token set. Mechanical work, high visible payoff. Do
`RunDetailPage` first and separately — it is worth shipping on its own.

---

## 3. Design tokens `[ ]` M

Move from convention to enforcement.

```css
/* Semantic, not literal. Components reference intent; the palette is defined once. */
--surface-base / --surface-raised / --surface-overlay
--border-subtle / --border-default / --border-strong
--text-primary / --text-secondary / --text-muted / --text-disabled
--accent / --accent-hover / --accent-subtle
--status-pass / --status-fail / --status-skip / --status-running / --status-healed
--space-1 … --space-8          (4px scale)
--radius-sm / --radius-md / --radius-lg / --radius-full
```

Then **ban raw colour literals in components** with a Biome rule. Today the
palette is a convention; a lint rule makes it a guarantee.

`--status-healed` is new and needed for [Phase 2.2](../plan/04-PHASE-2-HEALING.md)
— a healed pass must be visually distinct from a clean pass everywhere it appears.

---

## 4. Component gaps

Missing pieces that are currently re-implemented ad hoc on each screen:

| Component | Why | Effort |
|---|---|---|
| **Skeleton** | Spinners cause layout shift on every list; skeletons preserve it | S |
| **Breadcrumb** | Five-level hierarchy with no positional cue | S |
| **CommandPalette** | ⌘K global search ([IA §2](01-INFORMATION-ARCHITECTURE.md)) | M |
| **Combobox** | Custom dropdowns exist with no keyboard support or `aria-expanded` | M |
| **DiffView** | Needed by test versioning ([5.3](../plan/07-PHASE-5-PARITY.md)) and heal review | M |
| **KeyboardHint** | Discoverability for shortcuts — a shortcut nobody sees is not a feature | S |
| **CopyButton** | Re-implemented in several places | S |
| **StatusPill** | Consolidates `Badge` + `RunStatusBadge` + inline status spans | S |
| **Timeline** | Step waterfall in run detail ([02](02-SCREEN-REVIEWS.md)) | M |

`EmptyState` exists but is barely used — see
[CONTENT §4](03-CONTENT-AND-COPY.md).

---

## 5. Component conventions

1. **Every interactive element takes `data-testid`** — `{feature}-{descriptor}`.
   `Button` already declares it; make it required on new components.
2. **Loading is a component-level concern.** Every component that fetches renders
   its own skeleton at the right dimensions. No page-level spinner blanking a
   whole screen.
3. **Disabled needs a reason.** A disabled control carries a tooltip explaining
   what would enable it. A dead-end disabled button is a dead end.
4. **Compound components over prop explosions** — `<Card><Card.Header>` rather
   than `<Card headerTitle= headerAction= …>`.
5. **No component over ~300 lines.** Two current files are 4,501 and 4,995 lines;
   both are past maintainable, and the inconsistency in this document is largely
   downstream of that.

---

## 6. The two oversized screens `[ ]` L

| File | Lines |
|---|---|
| `pages/testing/TestingView.tsx` | **4,501** |
| `pages/modules/FeaturePage.tsx` | **4,995** |

`FeaturePage` has a `parts/` folder that was started and barely used.

These are not just a maintenance problem — they are *why* the UX drifts. At five
thousand lines nobody can see the whole screen, so each change is made locally and
conventions diverge.

Split when substantially touched, not as a standalone project. Extract along
existing seams: left panel, work pane, evidence capture, session controls.

---

## 7. Motion

Almost none today, which is defensible. Where it is added:

- **Transitions ≤ 150 ms.** This is a tool, not a showcase.
- Animate to explain state change (a row entering, a panel opening), never for
  decoration.
- Respect `prefers-reduced-motion` — non-negotiable.
- **Never animate a status change.** A test going red must be instant. Animation
  on a failure reads as the interface being pleased with itself.

---

## Acceptance

- [ ] All six light-mode screens converted, `RunDetailPage` shipped first
- [ ] Semantic token set defined; raw colour literals lint-blocked
- [ ] `--status-healed` exists and is used consistently
- [ ] Skeleton, Breadcrumb, StatusPill, CopyButton shipped
- [ ] Every new interactive element has `data-testid` and keyboard support
- [ ] `prefers-reduced-motion` respected
