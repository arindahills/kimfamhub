# ADR-029: One livestock engine for every herd, starting with goats

## Status: Accepted (2026-09-28)

## Context

The sheep tracker (ADR-026) worked for one club-owned flock. The family asked for the same
monitoring for goats (actions KIM/11/26-4, KIM/12/26-16) and, over time, every project. Goats
differ in one way that matters: about 55 goats are **individually owned** by family members (all
except Solomon and Hellen), so a sale's money is the owner's, not the club's, and counts matter per
owner. Two defects in the sheep tracker also surfaced: the recent-entries list read `e.id` and
`e.date`, which the API never sent, so its dates showed "undefined" and **its delete never worked**
(ADR-026 says it did); and deletes were physical, with no record of who removed what.

## Decision

- **Storage:** keep the `sheep_*` tables and add `project_id` (default `'sheep'`, so every existing
  row stays sheep), `owner`, `deleted_at` and `deleted_by` to `sheep_events` and `sheep_expenses`.
  The columns are checked in `information_schema` first and added under an advisory lock; if that
  fails, sheep reads keep working unscoped (no goats rows can exist yet) and only the livestock
  features report unavailable. The table names stay (renaming live tables costs more than the
  naming smell).
- **Engine:** `livestock.py` holds a per-project config (noun, recorders, event types, expense
  categories, ownership model, mortality-alert threshold) and the shared maths; `sheep.py` keeps its
  seed and sheep-only extras (valuation, pipeline, breeding model). Every read, write and delete is
  scoped by `project_id`; a goats URL can never touch a sheep row.
- **Ownership model:** `club` (sheep) keeps capital, sales and net position. `owners` (goats)
  reports counts and money **per owner** and produces no club profit or loss. Each owner has exactly
  one opening count (a second is rejected; correct it by removing and re-entering), and a death or
  sale cannot exceed that owner's own count.
- **Recorders:** sheep = Solomon + admins (unchanged). Goats = Solomon and Mum (Merab) + admins
  (Dad is an admin): the farm team records for every owner, as the goats actions assign. Owners
  read; they do not write. Decided on purpose, not an oversight.
- **Deletes are soft:** `deleted_at` / `deleted_by`, and the entry list shows owner and recorder.
- **API:** `POST /api/projects/{pid}/livestock/{event|expense}`,
  `DELETE /api/projects/{pid}/livestock/{event|expense}/{id}`, `GET /api/projects/goats/detail`;
  the original sheep URLs are aliases. Ask KimFam reads goats (incl. per owner) and states that goat
  money belongs to the owners. Goats is **not** in the portfolio investment ranking yet (an
  individually owned herd has no club return to score).

## Consequences

- Better: goats, and later dairy and rabbits (config only), get the sheep tracker's forms, charts,
  alerts and Ask KimFam; corrections finally work and leave a trail.
- Worse: the `sheep_*` names now hold other animals; the `summary.alive` key is added next to the
  sheep-specific `dorper_line_alive`.
- **Rollback trap:** code from before this ADR filters neither `project_id` nor `deleted_at`, so
  once goats rows or soft-deleted rows exist it would count goats as sheep and bring deleted
  corrections back. Any rollback target must include this commit. If that is impossible, first
  MOVE (not flag) every row with `project_id <> 'sheep'` or `deleted_at IS NOT NULL` from
  `sheep_events` and `sheep_expenses` into holding tables, then roll back.
- **Adoption risk:** Dad and Mum have never logged in to the Hub, and Solomon last did in June.
  Forms alone will not collect data; entry through WhatsApp is the likely follow-up.
