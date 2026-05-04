# Future Specs

This folder holds **forward-looking specifications** for features that are not yet on the active build path. Anything in `/docs/` (the parent folder) is in scope for the current implementation plan; anything in `/docs/future/` is **deliberately not yet committed**.

---

## When to put a doc here

- The spec is well-formed but the parent feature's MVP hasn't shipped yet
- The spec depends on a Phase 2+ product decision that isn't locked in
- The work is genuinely valuable but not a priority right now
- The spec captures "what we'd do next if this works" — preserves thinking that would otherwise be lost between sessions

---

## When to promote out of `future/`

A future doc is **promoted to `/docs/`** when:

1. The MVP it builds on has shipped and is stable
2. A product decision has explicitly committed to building it
3. It's been added to `IMPLEMENTATION_PLAN.md` and `PROGRESS_TRACKER.md` with a phase number

Promote by `git mv` to the parent docs folder + updating the doc table in `CLAUDE.md`.

---

## Current contents

| Doc | Builds on | Phase target |
|---|---|---|
| `TEST_RECORDER_PHASE_2.md` | `docs/TEST_RECORDER.md` (MVP) | Post-MVP polish — AI assertion suggestions, step name cleanup, Shadow DOM, agentic post-processing |
| `TEST_RECORDER_PHASE_3.md` | `docs/TEST_RECORDER.md` (MVP) + Phase 2 | Coverage expansion — Chrome extension, server-side CDP recorder, file upload capture, edit-existing-test recorder mode |

---

## Conventions

- Each future doc starts with **status, prereqs, and decision date**
- Use the same heading structure / tone as parent docs — they're meant to be promotion-ready
- Mark unresolved decisions clearly with `> **Open question:**` blocks
- Don't add tasks to `IMPLEMENTATION_PLAN.md` for anything in this folder — that's what promotion is for
