# Issue Viewer — Design Doc

> Status: **DRAFT — implementation pending**
> Owners: QA Platform team
> Dependencies: Issue model (existing), Notification model (existing),
> auth + redirect-after-login (existing), test-page deep-link (new)

---

## 1. Goal

A **dedicated, shareable, view-focused page** for a single Issue. When QA logs
a bug and pastes the URL into a Slack DM with a developer, the developer
opens the link, gets challenged for auth (if not signed in), and lands
directly on the issue with everything they need to triage it: title, severity,
description, repro steps, screenshot carousel, video recording, status
history, comments thread, and provenance (which test, run, env, who, when).

This complements — does NOT replace — the existing `<IssueDetailModal>`
inside the test-runner. Both are useful: the modal for in-flow triage, the
page for cross-team sharing.

### Non-goals (this doc)

- Editing the issue body, severity, or attachments — that stays in the
  log/edit modal. The viewer page has only the actions a triager actually
  needs: status change, assignee change, comments.
- Pushing to external trackers (Jira/ClickUp) — that lives in the
  IssueDetailModal already and can be lifted later if useful.
- Replacing the issue list/drawer — the page is reached via URL or
  notification click, not by drilling through a list.

---

## 2. URL structure

```
/issues/:issueId
```

- **Public path, auth-gated component**. Anyone can paste the URL; only
  authenticated members of the issue's project can render the body.
- `:issueId` is the existing UUID (`Issue.id`). No separate "share token"
  needed — the issue already lives behind project-membership RBAC, so the
  ID alone is enough provided we enforce membership on read.
- **Optional query params** for in-page state:
  - `?comment=<commentId>` — scrolls to that comment, highlights for 2 s
    (used by notification click-through "you were mentioned").
  - `?screenshot=<index>` — opens the carousel at that screenshot.

Examples:
- `https://qa.example.com/issues/8af0ca29-f5ff-488b-9062-35132d94af44`
- `https://qa.example.com/issues/8af0…?comment=2c3a…`

---

## 3. Auth + redirect-after-login flow

The redirect-after-login flow is a small extension of the existing
`<ProtectedRoute>` wrapper.

```
1. Dev clicks https://qa/issues/8af… in Slack.
2. Browser hits /issues/8af… → React renders <ProtectedRoute>.
3. <ProtectedRoute> sees no JWT in localStorage → redirects to
   /login?next=/issues/8af…
4. Dev signs in. LoginPage reads `?next=` from query, validates it's a
   same-origin path (security: no open redirect), navigates to it.
5. /issues/8af… renders. The page query checks project membership; if dev
   isn't a member of the issue's project, render a 403 card with "Request
   access" button (uses existing AccessRequest flow).
```

**Security guards on the redirect:**

- `next` MUST be a relative path starting with `/` AND not `//` (the
  double-slash form is a protocol-relative URL — open redirect vector).
- Reject any `next` containing `\r`, `\n`, or scheme-like patterns.
- Default to `/dashboard` if `next` is missing or invalid.

**Edge cases:**

- Issue deleted (soft-delete via `deletedAt`): render a "This issue was
  deleted" card with the original title (still in DB) and the date deleted.
  Don't 404 — preserves the link for context.
- User isn't a project member: render "You don't have access to this
  project" + "Request access" button (writes an AccessRequest row using
  the existing endpoint, reviewed by ORG_ADMIN).
- Org-level mismatch (issue belongs to org A, user is signed into org B):
  prompt to switch orgs ("This issue lives in **Acme QA**. Switch to view?").
  Use the existing org-switch endpoint.

---

## 4. Page layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← Back                                                              │
│                                                                      │
│  [BUG] [HIGH] OPEN · Login form rejects valid emails                 │  ← header
│  Demo Project / Account Management / Account Login / Test 3          │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  Reported by Ruan, 2 hours ago · Assigned to Sarah                   │  ← provenance row
│  Found during run #12 · UAT environment · Step "Submit form"         │
│  [Open the test ↗]   [View the run ↗]                                │
├──────────────────────────────────────────────────────────────────────┤
│  Description                                                          │
│  ──────────────────────────────────────────────────────────────────  │
│  Form submits but spinner hangs. Network tab shows 200 from API…     │
│                                                                      │
│  Steps to reproduce      |  Expected           |  Actual             │
│  1. Open /login          |  Land on dashboard  |  Spinner hangs      │
│  2. Enter creds          |                     |                     │
│  3. Submit               |                     |                     │
├──────────────────────────────────────────────────────────────────────┤
│  Evidence (3 screenshots, 1 recording)                                │
│  ┌─────────────────────────────┐  ┌─────────────────┐                │
│  │     [carousel of 3]         │  │   [video]       │                │
│  └─────────────────────────────┘  └─────────────────┘                │
│  • • ●         (carousel dots)                                        │
├──────────────────────────────────────────────────────────────────────┤
│  Status history                                                       │
│  • OPEN          (2h ago, Ruan)                                      │
│  • IN_PROGRESS   (1h ago, Sarah)  "Reproduced — looking at it"       │
├──────────────────────────────────────────────────────────────────────┤
│  Comments (5)                                                         │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ Sarah  · 1h ago                                              │    │
│  │ Looks like the API returns 200 but the spinner state         │    │
│  │ doesn't reset. @ruan can you confirm on staging?             │    │
│  └──────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ Ruan · 30m ago                                               │    │
│  │ @sarah confirmed staging is fine — UAT only.                 │    │
│  └──────────────────────────────────────────────────────────────┘    │
│  ──                                                                   │
│  [Type a comment… use @ to mention]                                   │
│  [Post comment]                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### Sections in detail

**Header**
- Type badge (BUG / SNAG / QUERY) — colored
- Severity badge — colored
- Status chip (OPEN / IN_PROGRESS / RESOLVED / WONT_FIX / CLOSED) — interactive
  for users with the right permission, plain badge otherwise (see §10)
- Title (h1)
- Breadcrumb: Project › Module › Feature › Test (any may be missing for
  scoped issues)

**Provenance row**
- Reporter avatar + name
- Assignee avatar + name (or "Unassigned" → click to assign)
- Run + step deep-link (when `testRunId` / `runStepId` set)
- Environment chip (looked up from the run)
- Two action buttons:
  - **Open the test ↗** → `/projects/:projectId/features/:featureId/test?testRunId=…&issue=:issueId`
    (TestingView reads `?issue=` and highlights the corresponding step row)
  - **View the run ↗** → existing run detail page

**Description block**
- Rich text (preserve newlines, render markdown if content looks like
  markdown — light parser, not full md so the page is fast)
- Three-column responsive grid for stepsToReproduce / expectedBehaviour /
  actualBehaviour. Stacks on mobile.

**Evidence block**
- **Carousel** for `screenshotUrls` — keyboard arrows, dots, click-to-zoom
  modal. URL deep-link via `?screenshot=:index`.
- **Video player** for `recordingUrl` if present — native `<video>` with
  controls, default volume 0 (muted), poster from first frame.
- Both carousel and player are lazy-loaded (img loading="lazy",
  video preload="metadata") so the page LCP isn't blocked by media.

**Status history**
- Reverse-chronological list of `IssueStatusHistory` rows.
- Each entry: status pill, timestamp, actor, optional note.
- Compact — single line per entry unless note is present.

**Comments**
- Thread of `IssueComment` rows, oldest first (matches Slack/Linear).
- Each comment renders @mentions as styled chips (purple, hover shows
  user's full name).
- Composer at the bottom — multiline, Enter for newline,
  Cmd/Ctrl+Enter to post. Inline @mention picker (typeahead from project
  members + org admins).

---

## 5. Data model — gaps + additions

### Existing models we use as-is

- `Issue` — already has all visible fields plus screenshotUrls (string[])
  and recordingUrl (string?). No schema change needed.
- `IssueComment` — `content` field already exists.
- `IssueStatusHistory` — already has `fromStatus`, `toStatus`, `note`,
  `changedBy`, `createdAt`. Used as-is.
- `Notification` — generic enough to carry "you were mentioned" — see §7.

### New additions

**`NotificationType` enum — add two values**

```
ISSUE_MENTIONED         // @mentioned in a comment
ISSUE_ASSIGNED          // assigned the issue (existing flow but no NotificationType)
ISSUE_STATUS_CHANGED    // status moved on an issue you're watching/assigned to
```

The `Notification.meta` JSON column carries:

```jsonc
{
  "issueId": "8af0…",
  "issueTitle": "Login form rejects valid emails",
  "commentId": "2c3a…",        // ISSUE_MENTIONED only
  "fromStatus": "OPEN",        // ISSUE_STATUS_CHANGED only
  "toStatus": "IN_PROGRESS",
  "actorId": "e194…",          // who did it (so notif copy reads natural)
  "actorName": "Sarah Lee"
}
```

`Notification.actionUrl`:
- ISSUE_MENTIONED → `/issues/:issueId?comment=:commentId`
- ISSUE_ASSIGNED  → `/issues/:issueId`
- ISSUE_STATUS_CHANGED → `/issues/:issueId`

**Optional new model — `IssueWatcher`** (low priority, deferred)

Lets a user follow an issue without being assigned to it. For v1 we
notify only on:
- @mention (always)
- assignee change (notify the new assignee)
- status change (notify reporter + current assignee)

Watching is a follow-up.

---

## 6. API endpoints

All under `/api/v1`, all require JWT, all assert project membership unless
noted.

### Read

```
GET  /issues/:id
       → returns the issue + nested comments + status history +
         author/assignee/resolver profiles + denormalized run/env names.
       → 403 if user is not a project member; payload tells the SPA to
         render the "request access" UI.
       → 410 (Gone) if soft-deleted; payload includes deletedAt.

GET  /issues/:id/comments
       → optional standalone fetch (used by polling / refetch). Returns
         comments oldest-first.
```

### Write

```
POST   /issues/:id/comments
         body: { content: string }
         → creates IssueComment, parses @mentions, dispatches
           ISSUE_MENTIONED notifications atomically in the same tx.
         → returns the created comment with author profile inlined.

PATCH  /issues/:id
         body: { status?, assignedToId?, severity? }
         → status change writes IssueStatusHistory + dispatches
           ISSUE_STATUS_CHANGED notifications.
         → assignee change dispatches ISSUE_ASSIGNED notification.
         → severity change is silent (no notif).

DELETE /issues/:id/comments/:commentId
         → soft delete (sets deletedAt). Comments only deletable by
           author OR project OWNER/TECH_LEAD.
```

### @mention autocomplete

```
GET  /issues/:id/mentionable
       → returns the union of (project members ∪ ORG_ADMINs of issue's
         org). Payload shape: [{ id, name, email, avatarUrl, role }]
       → cached client-side for the lifetime of the page.
```

Why server-side, not just project members from the cache: so a user
@mentioning an ORG_ADMIN (who isn't a direct project member) still works.

---

## 7. @mention parsing + dispatch

### Detection

In the API's `addComment` service:

```ts
const mentionedUsernames = extractMentions(content);
// matches /(^|[^a-z0-9_])@([a-z0-9_.-]+)/gi
// returns ['@ruan', '@sarah'] from "@ruan can you confirm? @sarah too"
```

### Resolution

For each mention, look up the user by:
1. Exact email-localpart match (`ruan` → `ruan@…`)
2. Then by name slug (`sarah-lee` → "Sarah Lee")
3. Skip unresolved mentions silently — don't fail the comment write.

Limit: max 10 mentions per comment to prevent notification spam.

### Notification creation (atomic)

Inside the same Prisma transaction that writes `IssueComment`:

```ts
await tx.issueComment.create({ … });
const mentioned = await resolveMentions(content, projectId, orgId, tx);
await tx.notification.createMany({
  data: mentioned
    .filter(u => u.id !== ctx.userId)        // never notify the commenter
    .map(u => ({
      userId: u.id,
      orgId,
      type: 'ISSUE_MENTIONED',
      category: 'ASSIGNMENT',
      title: `${actor.name} mentioned you in "${issue.title}"`,
      body: truncate(content, 140),
      actionUrl: `/issues/${issue.id}?comment=${comment.id}`,
      actionLabel: 'Open issue',
      meta: { issueId: issue.id, commentId: comment.id, actorId, actorName: actor.name },
    })),
});
```

If the same user is mentioned twice in one comment we de-dup before write.

### Anti-spam

- Same user can't be mentioned more than once per comment (de-duped above).
- Rate limit: max 50 ISSUE_MENTIONED notifications per recipient per hour
  (clamp on the read-side via `notifications.count(where: ..., take: 50)`).

---

## 8. Notification → click-through to test page with highlight

The user requested a specific UX: clicking the notification should not just
open the issue page — for issues caught during a test run, **first take the
user to the live test view with the offending step highlighted, then offer
"Open issue" from there**.

### Routing rule

```
Notification.actionUrl  decides where the click lands:

  - ISSUE_MENTIONED   → /issues/:id?comment=:commentId
                        (mention is about a discussion, not the test —
                         comment thread is the priority destination)

  - ISSUE_STATUS_CHANGED →
      if issue.testRunId exists:
        /projects/:projectId/features/:featureId/test
          ?testRunId=:testRunId
          &issue=:issueId
          &highlightStep=:runStepId
      else:
        /issues/:id
```

### TestingView reads the deep-link params

When TestingView mounts:

```ts
const issueId       = searchParams.get('issue');       // string | null
const highlightStep = searchParams.get('highlightStep'); // string | null
```

Behavior:
- If `highlightStep` is set: scroll the step list to that row; pulse-flash
  it for 2 s (purple ring fading out); auto-expand the test row that owns it.
- If `issue` is set: render an inline banner at the top of the right pane:
  > 🐞 BUG #8af0… "Login form rejects valid emails" — [Open issue ↗]
  Banner is dismissible (sets `?issue=` to empty).

### Server-side: which URL gets stored

`NotificationsService.createIssueMention()` and friends build the URL from
the issue + run context **at notification creation time**, not at click time.
That way:
- Renaming/deleting the run later doesn't break the click.
- The notification body is permanent (`Notification` rows are immutable).

---

## 9. Frontend — route + page module

### Route registration (App.tsx)

```tsx
// Inside the <Shell> protected branch:
<Route path="issues/:issueId" element={<IssuePage />} />
```

The page uses the standard Shell wrapper (top nav + sidebar visible) so the
viewer feels like part of the app, not a kiosk.

### File: `apps/web/src/pages/issues/IssuePage.tsx`

Top-level structure:

```tsx
export function IssuePage() {
  const { issueId } = useParams();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error } = useQuery(['issue', issueId], …);

  if (isLoading) return <PageSpinner />;
  if (error?.status === 403) return <NoAccessCard issue={…} />;
  if (error?.status === 410) return <DeletedIssueCard issue={…} />;
  if (!data)              return <NotFoundCard />;

  return (
    <div className="max-w-4xl mx-auto py-6 space-y-6">
      <IssueHeader issue={data} />
      <ProvenanceRow issue={data} />
      <DescriptionBlock issue={data} />
      <EvidenceBlock
        screenshots={data.screenshotUrls}
        recording={data.recordingUrl}
        initialIndex={Number(params.get('screenshot') ?? 0)}
      />
      <StatusHistoryList issue={data} />
      <CommentsSection
        issueId={issueId}
        scrollToCommentId={params.get('comment')}
      />
    </div>
  );
}
```

### Component breakdown

| Component | Responsibility |
|---|---|
| `IssueHeader` | Type/severity/status badges, title, breadcrumb. Status chip is interactive only for OWNER/TECH_LEAD/QA_ENGINEER. |
| `ProvenanceRow` | Reporter, assignee, run + env, deep-link buttons. |
| `DescriptionBlock` | Description + 3-col grid. Light markdown rendering (paragraphs + bold + links + code blocks). |
| `EvidenceCarousel` | Image carousel: arrow keys, dots, click-to-zoom modal. URL-syncs via `?screenshot=`. |
| `EvidenceVideo` | `<video controls preload="metadata">` with poster generated from first frame on hover. |
| `StatusHistoryList` | Reverse-chronological list of IssueStatusHistory entries. |
| `CommentsSection` | Comment list + composer. Composer has @mention typeahead. |
| `MentionTypeahead` | Inline picker fed by `/issues/:id/mentionable`. |
| `NoAccessCard` | "You don't have access" + Request access button. |
| `DeletedIssueCard` | "Deleted on …" + read-only metadata. |

### Composer @mention typeahead (client-side)

When user types `@`, intercept keystrokes:

```
On keypress '@':
  - Capture cursor position.
  - Open dropdown beneath that position with all mentionable users.

On keypress while dropdown open:
  - Filter list by query (chars after @).
  - Esc closes; Enter / Tab inserts.
  - Inserted as plain text "@username" — server re-parses on save so the
    source of truth is always the rendered comment text.
```

Why store mentions as plain text not entity refs: simpler model, one
source of truth, no link rot if a user is renamed (we re-resolve on read
when rendering for display). Trade-off accepted.

---

## 10. Status tracking — who can change

| Action | Permitted roles |
|---|---|
| Comment | Any project member; ORG_ADMIN of the issue's org. |
| Change status | Any project member EXCEPT MANAGER (read-only role). |
| Reassign | Same as status change. |
| Resolve / Close | Same. Sets `resolvedById` + `resolvedAt`. |
| Reopen (RESOLVED → OPEN) | Same. |
| Soft-delete the issue | OWNER, TECH_LEAD, ORG_ADMIN. |
| Hard delete | PLATFORM_ADMIN only. |

Server enforces all of the above via the existing `EnvAccessService` /
project-membership checks. The page UI hides actions the user can't
perform — but never relies on UI hiding for security.

### Status-change UX

Click status chip → dropdown with allowed transitions:

```
OPEN          → IN_PROGRESS, WONT_FIX, CLOSED
IN_PROGRESS   → RESOLVED, WONT_FIX, OPEN
RESOLVED      → CLOSED, OPEN
WONT_FIX      → OPEN
CLOSED        → OPEN
```

After picking a target, prompt for an optional note (sometimes empty is
fine — e.g. "OPEN → CLOSED" by reporter who realized it was their mistake).
Note goes onto `IssueStatusHistory.note`.

---

## 11. Sharing UX

A "Copy link" button in the page header copies `${WEB_URL}/issues/:id` to
the clipboard. Toast confirms ("Link copied — paste anywhere").

Sharing semantics:
- Link is **permanent** and **unguessable** (UUID in path; no listing
  endpoint exposes UUIDs without auth).
- No public mode, no expiring share tokens. Auth is the gate.
- Org/project-scoped: a shared link to an Acme issue is useless to a
  Globex user — they get the access denied card.

If "public read-only share" becomes a real requirement later, we'd add a
separate `IssueShareToken` row with TTL + single-issue scope, exposed via
`/share/:token`. **Not in v1.**

---

## 12. Performance + caching

- Issue payload is ~1–10 KB; one query covers everything except media.
- Screenshots + recording load lazily — main page LCP is unaffected.
- React Query cache: `['issue', issueId]` with `staleTime: 60_000`.
  Comments are a separate key (`['issue-comments', issueId]`,
  `staleTime: 15_000`) so post-comment refetch is fast.
- Socket integration (optional, deferred): the existing notifications
  socket can push "new comment on issue X" events to update the comments
  list in real time. v1 polls every 30 s on window-focus.

---

## 13. Edge cases + error states

| Scenario | Behavior |
|---|---|
| Issue deleted | `DeletedIssueCard` — read-only, shows title + deletion timestamp. Comments + history hidden. |
| Issue belongs to a different org than the user's active one | Modal: "Switch to **Acme QA** to view this issue?" → calls `/auth/switch-org/:orgId`, then re-loads. |
| Issue belongs to a project the user isn't a member of | `NoAccessCard` with **Request access** button (writes AccessRequest, ORG_ADMIN reviews). |
| Screenshot URLs return 404 | Show a placeholder card "Image unavailable — may have been cleaned up". Don't break the carousel. |
| Recording URL returns 404 | Hide the video block entirely with a small note. |
| User is logged out mid-session | `axios` interceptor refresh-token flow handles it transparently; if refresh fails, redirect to `/login?next=/issues/:id`. |
| @mention resolves to a deactivated user | Skip silently — no notification. The comment text still reads "@deactivated-user". |
| Two simultaneous status changes | Last write wins. Status history has both entries — provides audit. |
| Issue moved between projects (future feature) | Out of scope for v1; assume issues are immutable wrt project. |

---

## 14. Phased implementation plan

Each phase ends in a working, mergeable state. Don't bundle phases —
keep PRs small for review.

### Phase 1 — read-only page + view audit ~4 h
1. Schema:
   - Add `NotificationType` values: `ISSUE_MENTIONED`, `ISSUE_ASSIGNED`,
     `ISSUE_STATUS_CHANGED`.
   - Add `IssueView` model + `User.notificationPrefs Json @default("{}")`.
   - Apply via `prisma db push` in dev, real migration before prod.
2. `GET /issues/:id` — full payload incl. nested comments, history,
   plus `viewCount` and (for privileged readers) the viewer list.
3. `POST /issues/:id/view` — upsert IssueView row, skip reporter.
4. `GET /issues/:id/views` — gated to reporter / assignee / OWNER /
   TECH_LEAD / ORG_ADMIN.
5. `IssuePage` route wired in App.tsx.
6. Static layout (mobile-aware): header with "Seen by" pill, provenance,
   description with linkified URLs, evidence carousel, video player,
   status history, comments list (read-only — no composer).
7. Edge-case cards: NoAccess, Deleted, NotFound, WrongOrg (with
   switch-org button).

### Phase 2 — actions ~2 h
8. Status chip → dropdown with allowed transitions, optional note.
9. Reassign UI (member picker).
10. Comments composer (plain text, autolinker-on-render only). Sticky to
    viewport bottom on mobile.
11. `POST /issues/:id/comments` wired.
12. Soft-delete own comments (author / OWNER / TECH_LEAD).

### Phase 3 — @mentions + notification prefs ~3–4 h
13. `GET /issues/:id/mentionable` endpoint.
14. Inline @mention typeahead in composer.
15. Server-side parse + dispatch in `addComment` (atomic with the
    comment write).
16. `notification-defaults.ts` map + `resolveChannels()` helper.
17. `PATCH /auth/me/notification-prefs` endpoint.
18. Settings page → Notifications card: per-type [in-app] [email]
    toggles, "Reset to defaults" per row.
19. Render received @mentions as chips on read; tooltip shows full name.

### Phase 4 — email delivery ~2 h
20. New BullMQ queue `notification-email` + worker handler.
21. MJML templates: `issueMentioned.mjml.ts`, `issueAssigned.mjml.ts`.
22. Redis dedup key (`notif:dedup:…`) so the same (user, type, issue)
    pair doesn't fire >1 email per 5 min.
23. Smoke test: trigger mention → in-app row appears + email queued +
    dedup blocks the second send within 5 min.

### Phase 5 — test-page deep link ~1 h
24. `TestingView` reads `?issue=`, `?highlightStep=` from URL.
25. Inline issue banner at top of right pane (dismissible).
26. Step-row scroll + pulse-flash for `highlightStep`.
27. `NotificationsService` builds `actionUrl` with run context for
    ISSUE_STATUS_CHANGED.

### Phase 6 — sharing polish ~1 h
28. Copy-link button + toast.
29. Login-page reads `?next=` from URL, validates, redirects on
    success.
30. Playwright smoke: "log out → click `/issues/:id` link → login →
    land on issue → click @mention notif → land on test page with
    step pulsed".

Total estimate: **~13–15 h** spread across 6 phases (notification prefs
+ view audit + mobile add ~4 h on top of the original 9–11 h estimate).

---

## 15. Decisions (was: Open questions)

All confirmed before build:

1. **Description + comments are plain text.** No markdown rendering.
   Newlines preserved (whitespace-pre-wrap). URL strings auto-linkified
   client-side at render time (cheap regex), but `**bold**`, `_italic_`,
   etc. render literally — no parsing, no sanitisation surface area.
   Server stores exactly what the user typed.

2. **Member mentions only.** `@team` / `@qa-engineers` not in scope.
   Resolution path is exactly the rule in §7 (email-localpart → name slug
   against project members ∪ ORG_ADMINs).

3. **Notification delivery is a user preference.** Default is in-app
   only. Each user can toggle per-category email delivery on top — see
   §17 below for the model + UI.

4. **Permanent links across project moves are supported.**
   `/issues/:id` resolves by UUID regardless of project; the breadcrumb
   re-renders from whatever project the issue currently belongs to. No
   redirect / 410 needed when an issue moves. Cross-project move is
   itself a separate feature; this doc just guarantees the link survives.

5. **Mobile / small viewport — first-class.**
   - Three-column repro/expected/actual grid → stacks vertical at <768 px.
   - Carousel → full-bleed (edge-to-edge), swipe gestures, dots fixed
     to bottom-overlay.
   - Video → full-width, native controls, tap-to-play (no autoplay).
   - Status history → collapsed by default below 768 px ("Show 4
     transitions" toggle) since it's secondary on mobile.
   - Comments composer → sticky to bottom of viewport (chat pattern),
     content area scrolls behind it.
   - Header buttons (Copy link, Status chip) → primary stays visible,
     overflow into a `…` menu.

6. **Audit trail of who viewed the issue is in v1.** Dedupe + count
   model: one row per (issueId, userId) with `firstViewedAt`,
   `lastViewedAt`, `viewCount`. Surfaced on the page header as a small
   "Seen by 4" pill that opens a popover listing the viewers. See §18.

---

---

## 16. Notification preferences (decision #3)

### Schema

Add a single JSON column on User — keeps the model lean and lets us add
new categories without migrations:

```prisma
model User {
  // … existing fields …
  /// Per-category notification delivery prefs. Shape:
  /// { "<NotificationType>": { "inApp": boolean, "email": boolean } }
  /// Missing keys fall back to the per-category default in
  /// notificationDefaults() in the API. Stored as JSON so we can ship
  /// new types (and their defaults) without DB migrations.
  notificationPrefs Json @default("{}")
}
```

### Defaults

In `apps/api/src/modules/notifications/notification-defaults.ts`:

```ts
// Per-NotificationType default delivery channels. The truth is in code,
// not the DB — adding a new type means updating this map, not migrating
// every user row. Channels not listed default to { inApp: true, email: false }.
export const NOTIFICATION_DEFAULTS: Record<NotificationType, ChannelPrefs> = {
  ISSUE_MENTIONED:        { inApp: true, email: false },
  ISSUE_ASSIGNED:         { inApp: true, email: true  },  // assignment is high-signal
  ISSUE_STATUS_CHANGED:   { inApp: true, email: false },
  FEATURE_RUN_FAILED:     { inApp: true, email: true  },  // existing types' defaults
  // …all existing types listed explicitly so nothing's implicit
};
```

### Resolution

When dispatching a notification:

```ts
function resolveChannels(userPrefs: object, type: NotificationType): ChannelPrefs {
  return {
    ...NOTIFICATION_DEFAULTS[type],   // start from default
    ...userPrefs[type],               // user override on top (partial OK)
  };
}
```

The dispatcher creates the `Notification` row only if `channels.inApp`
is true (and queues an email send only if `channels.email` is true).
The row + email are independent — disabling in-app doesn't disable email.

### UI — Settings → Notifications

Add to the existing Notifications card on `/settings`:

```
Notifications
─────────────
                                   In-app    Email
ISSUE_MENTIONED  Mentioned in a comment    [✓]       [ ]
ISSUE_ASSIGNED   Assigned to an issue      [✓]       [✓]
ISSUE_STATUS_…   Status changed            [✓]       [ ]
FEATURE_RUN_FAILED  Run failed             [✓]       [✓]
…
                                   ─────  ─────
                                   Save preferences
```

- Loaded via `GET /auth/me` (extends payload to include
  `notificationPrefs`).
- Saved via `PATCH /auth/me/notification-prefs` (whole object replace).
- Toggles render the EFFECTIVE state — i.e. `prefs[type] ?? defaults[type]`.
  Saving sends the user's full overrides (sparse) so we don't bake the
  defaults into every row.
- A small "Reset to defaults" link wipes the user's overrides for that
  row.

### Email delivery

When `channels.email` is true the dispatcher enqueues a job on a new
`notification-email` BullMQ queue. The worker picks it up, renders an
MJML template (one per `NotificationType` — e.g. `issueMentioned.tsx`),
sends via the existing `EmailService`. Async + retryable + queued so a
hot mention doesn't block the comment write.

For v1 we ship two templates:
- `issueMentioned.mjml.ts` — single-mention email.
- `issueAssigned.mjml.ts` — single-assignment email.

Both link to `${WEB_URL}/issues/:id`. Subject line includes the issue
title so it's actionable from the inbox preview.

### Anti-spam (email)

- Per recipient, max 1 email per (issueId, type) per 5 min — coalesced
  via Redis SETNX with a 5-min TTL keyed on `notif:dedup:<userId>:<type>:<issueId>`.
- "Reply all" style mass-mention to 10 people: 10 in-app rows, but only
  the people whose prefs allow email get an email.

---

## 17. View audit trail (decision #6)

### Schema

```prisma
model IssueView {
  id              String   @id @default(uuid())
  issueId         String
  issue           Issue    @relation(fields: [issueId], references: [id], onDelete: Cascade)
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  firstViewedAt   DateTime @default(now())
  lastViewedAt    DateTime @default(now())
  viewCount       Int      @default(1)

  @@unique([issueId, userId])           // one row per viewer
  @@index([issueId, lastViewedAt])      // "who viewed recently"
  @@map("issue_views")
}
```

Append-and-update model: first visit creates the row, subsequent visits
update `lastViewedAt` + increment `viewCount`. One row per viewer →
counts grow linearly with team size, not click count. Won't grow
unbounded.

### Recording a view

Page mount fires `POST /issues/:id/view` (fire-and-forget, no UI block):

```ts
// Inside IssuePage on first render where data is loaded.
useEffect(() => {
  if (!data) return;
  api.post(`/api/v1/issues/${data.id}/view`).catch(() => { /* swallow */ });
}, [data?.id]);
```

The endpoint:

```ts
@Post('issues/:id/view')
async recordView(@Param('id') id: string, @CurrentUser() user) {
  await this.prisma.issueView.upsert({
    where:  { issueId_userId: { issueId: id, userId: user.sub } },
    create: { issueId: id, userId: user.sub },
    update: { lastViewedAt: new Date(), viewCount: { increment: 1 } },
  });
  return { ok: true };
}
```

### Don't count the reporter's own visits

The reporter sees the issue while logging it; counting them in "Seen by"
is noise. Guard:

```ts
if (user.sub === issue.reportedById) return { ok: true };  // skip
```

We still upsert IF you explicitly want this visible — but for v1 we just
skip the insert.

### Surface — "Seen by" pill

In `IssueHeader`:

```
┌─────────────────────────────────────────────────────────────┐
│ [BUG] [HIGH] OPEN · Login form rejects valid emails  👁 4   │
└─────────────────────────────────────────────────────────────┘
```

The pill (eye icon + count) opens a popover:

```
Seen by
───────────
Sarah Lee       just now
Marcus Chen     2h ago
Priya Patel     4h ago
Tom Anderson    yesterday
```

### API for the popover

```
GET /issues/:id/views
  → returns: [{ userId, name, avatarUrl, firstViewedAt, lastViewedAt, viewCount }]
  → ordered by lastViewedAt desc, take 20
  → 403 if not project member (same as issue read)
```

Only the reporter, assignee, project OWNER/TECH_LEAD, and ORG_ADMIN can
see the popover. Other viewers see just the count, no list — privacy
balance: "you can see a dev opened your bug" but not "all 8 colleagues
saw your bug".

### Privacy + opt-out

Out of scope for v1, but worth noting: if a user later asks to opt out
of view tracking, we'd add a per-user toggle that writes a "private"
flag on their `IssueView` rows; popover would render them as "(hidden)".

---

## 18. Summary

A self-contained, view-focused issue page reachable at `/issues/:id`,
shareable across teams, gated by authentication + project membership, with
a screenshot carousel, video player, comments, @mentions, and in-app
notifications that route mention recipients straight to the right place
(test page with the offending step highlighted, or the comment thread).

Implementation is phased; each phase ships independently usable value:
1. Static page works for sharing and triage.
2. Comments + status changes round out the workflow.
3. @mentions + notifications close the collaboration loop.
4. Test-page deep-link makes "we found a bug" actionable in one click.
5. Sharing polish + redirect-after-login is the final UX gloss.
