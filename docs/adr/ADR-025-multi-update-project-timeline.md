# ADR-025: Multi-Update Project Timeline

## Status: Accepted

## Context
The project board showed exactly one update per project: `GET /api/projects/all` collapsed
`project_updates` to the newest row via SQL `DISTINCT ON` + `_best_update`, and the card
rendered a single "Latest Update" line with one date. Members asked to see a running
history — newest first, with older/superseded items tidied away — not a single stale line.
The board also carries a few hardcoded, media-rich inline updates (washing_bay, sheep,
dairy) that a naive "just return the DB rows" change would drop.

## Decision
Return a per-project `updates[]` timeline and render it as a collapsible feed.

- `get_all_projects` now fetches the newest N (`_TIMELINE_LIMIT = 6`) updates **per project**,
  bounded in SQL with `ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC)`
  (not an unbounded full scan). A failed query is logged, not silently swallowed.
- A pure, unit-tested module `project_timeline.build_timeline(db_rows, hardcoded_update,
  limit)` builds each timeline:
  - **Pins the hardcoded update** — it is never evicted by the cap, so media-rich one-off
    updates never vanish from the board (reserves a slot when present).
  - **Supersede is conservative**: only a TEXT-ONLY older update whose action-refs
    (`KIM/xx/xx-x`) are all already covered by a newer update is marked `superseded`.
    Media-bearing reports and the pinned hardcoded update are never hidden — a mere ref
    mention is not a replacement.
  - Orders newest-first (Africa/Nairobi, end-of-day for date-only hardcoded rows), and
    never mutates the caller's dicts.
- `p["update"]` is retained for backward-compat (it may differ from `updates[0]` only on a
  same-date media tiebreak in `_best_update`).
- Frontend `ProjectsPage` renders `UpdateTimeline`: the 2 newest expanded, older/superseded
  items behind a "Show N older" toggle (superseded ones dimmed), each with its own
  read-more.

## Consequences
- **Better**: the board is a living feed — members see history newest-first, and stale
  text-only notes fold away without hiding photo/video reports.
- **Better**: timeline logic is a pure module with 8 unit tests (incl. regression tests for
  the pin-survives-cap and media-not-superseded cases) + a smoke assertion on
  `/api/projects/all`; it no longer lives as an untestable endpoint closure.
- **API contract**: `GET /api/projects/all` now includes `updates: [{id, date, author, text,
  images, videos, superseded}]` per project. Additive; existing `update` field unchanged.
- **Watch**: `INVESTMENT_TERMS`-style structured data is unaffected; the supersede heuristic
  is deliberately weak (ref-mention + text-only) — if members want manual "pin/hide"
  control later, revisit here.
