# Decision trace: every number answers "why", with who said it

Status: plan for build (2 Oct 2026). Issue: see the board milestone "Decision Trace".
Companion ADR to write with the change: ADR-034.

## Goal
A member looking at any figure on a project (a sale, an expense, a stock movement, a scorecard KPI, a
projection line, a club payment) can press **Why?** and see the chain that explains it:

1. the **decision** (what was agreed, in plain words),
2. **who said it**, in which meeting and at what point (a verbatim quote, with a link to the transcript position),
3. **why** (the reason given in the meeting, as a quote and a one-line summary),
4. the **action** that followed (owner, deadline, status, later updates),
5. the **outcome** in numbers (the ledger rows it caused, and how they compare with the projection).

On top of that, a **smart report per project** that reads as a story with evidence, not a table: what was
decided, why, what it cost, what happened, where reality departed from the plan, and what is still unexplained.
Every sentence in that report cites a decision, action or ledger row by id.

## What already exists (do not rebuild)
- Postgres tables: `meetings` (ref, date, key_topics, key_decisions, summary, transcript text, minutes_url,
  attendance), `actions` (ref like KIM/17/26-11, assignee(s), project_id, meeting_id, related_meeting, status,
  deadline), `action_updates` (dated notes with author), `action_links` (from_ref, to_ref, link_type),
  `project_updates`, `expenditure_records` (club treasury).
- The project ledger (ADR-032): `ledger_expenses|sales|stock|losses|products`, `ledger_notes`,
  `ledger_reimbursements`; reconciliation open items have stable keys (`treasury:<id>`, `birds:*`, `gap`, ...).
- Ask KimFam (`ask_agent.py`, RAG over minutes) and the WhatsApp agent (separate repo).
- Coverage today: 18 meetings; the 9 most recent (June 2026 onward) have full transcripts; older ones have only
  minutes and key decisions; about 175 actions, 9 tagged to the chicken project.

## Hard rules (from the family's standing rules)
1. **Never invent attribution.** A speaker is named only if the transcript labels that speaker. Otherwise the
   quote is shown as "unattributed". Every quote must exist verbatim in the stored transcript; code checks
   this and drops any decision whose quote cannot be found.
2. **Citations are mandatory.** A generated sentence with no valid citation is removed, not softened.
3. **No finances, member names or personal data in this public repo** (code, tests, docs, fixtures). Tests use
   synthetic meetings and synthetic names. Real data stays in the database.
4. **Private meetings are excluded.** A meeting flagged private is never indexed or quoted.
5. AI proposes, people confirm money links: a decision-to-ledger link suggested by the system is shown as
   "suggested" until an admin confirms it. Quotes and decisions are shown with an "unreviewed" badge until
   an admin reviews them.
6. Claude is the default model (Gemini only as fallback), through the existing helper used by Ask KimFam.

## Data model (new tables, created under an advisory lock like `ledger.ready()`)
- `decisions`: id, project_id, meeting_id, meeting_ref, statement, rationale (one line), quote (verbatim),
  quote_start (character offset in the transcript), speaker (member name or NULL), amount_ugx (nullable),
  effective_date (nullable), status (`agreed`, `proposed`, `superseded`, `reversed`), supersedes_id,
  confidence (0 to 1), review_state (`unreviewed`, `confirmed`, `corrected`), reviewed_by, reviewed_at,
  source (`transcript`, `minutes`), created_at, deleted_at. Unique on (meeting_id, quote_start, statement).
- `decision_links`: id, decision_id, target_type (`action`, `ledger_expense`, `ledger_sale`, `ledger_stock`,
  `ledger_loss`, `treasury_payment`, `projection_line`, `kpi`, `open_item`), target_ref, relation
  (`authorised`, `caused`, `explains`, `contradicts`), state (`suggested`, `confirmed`, `rejected`), note,
  created_by, created_at. Unique on (decision_id, target_type, target_ref, relation).
- Reuse `actions` and `action_links`; add nothing there except an index on `actions.meeting_id`.

## Phases

### Phase 0: audit (read-only; run by the maintainer on the real data, the agent builds the script)
`scripts/decision_audit.py`: prints a coverage table per meeting: transcript present, speaker labels present
(fraction of lines with a speaker prefix), key_decisions present, number of actions linked, chicken-tagged
actions. No quotes printed. Output decides how many meetings can be attributed to a speaker.

### Phase 1: extraction pipeline (pure code + tests; the maintainer runs it on the server)
`decision_trace.py`:
- `chunk_transcript(text)` splits by speaker turn with offsets; works with and without speaker labels.
- `build_prompt(chunk, meeting_meta, projects)` asks Claude for strict JSON:
  `{"decisions":[{"project_id","statement","rationale","quote","speaker","amount_ugx","effective_date","status"}]}`.
  Only things the group agreed or resolved; opinions, questions and chatter produce nothing.
- `check(raw, transcript)` re-checks everything: quote found verbatim (normalised whitespace), speaker is a
  known member and appears in the labelled turn that contains the quote, amount and date parse, project_id is
  a known project, statement length bounded. Anything doubtful is dropped or marked `unattributed`.
- `extract_meeting(meeting_id)` is idempotent: re-running a meeting adds nothing already stored.
- A minutes-only fallback: decisions from `key_decisions` bullets, `source='minutes'`, no quote, no speaker.
- Tests with synthetic transcripts: verbatim-quote check, hallucinated quote dropped, unlabelled speaker gives
  NULL, idempotency, private meeting skipped, amounts like "1.3m" and "500k" parsed.

### Phase 2: links
- `suggest_links(project_id)`: for each decision, find candidates: actions of the same meeting or project whose
  text overlaps; ledger rows whose date is within 45 days after the meeting and whose amount matches the
  decision's amount (exact or within 5 percent), or whose item keywords overlap; treasury payments likewise.
  Stores `suggested` links with a score and the reason in `note`. Never confirms by itself.
- Admin endpoints to confirm, reject, or add a link by hand. A confirmed link is shown everywhere; a suggested
  one is shown dashed with "suggested".
- Tests: amount-and-date match suggested; unrelated row not suggested; a rejected link is not re-suggested.

### Phase 3: trace API and UI
- `GET /api/trace/{project_id}?target_type=&target_ref=` returns the chain for any target: decisions (with quote,
  speaker, meeting ref and date, offset, review state), actions (owner, deadline, status, dated updates),
  outcome rows (ledger rows linked, their totals), and the projection line if any. Login required (members only,
  never public). `GET /api/decisions/{project_id}` lists the register with filters (meeting, status, review).
- UI: a **Why?** button on every row in the ledger Entries, every open item in Reconciliation, and every drill-down
  line (see the drill-down ticket); it opens a panel with the chain as a timeline. A **Decisions** tab on the
  ledger page lists the register, grouped by meeting, with a review control for admins.
- Meeting transcript position: the panel shows the quote with 2 lines of context either side and the meeting
  ref; if a recording link exists, link to it.
- Follow the existing front-end conventions (Tailwind variables, `LedgerPage.tsx` patterns), type-safe, no `any`;
  `npx tsc -b` and `npx eslint` clean.

### Phase 4: the smart report
- `GET /api/trace/{project_id}/report` builds a structured evidence pack from the data (decisions in date order,
  actions and outcomes, ledger and projection variances, open items) and asks Claude to write a narrative
  with these sections: Summary, Timeline of decisions, What it cost and what it earned, Where reality departed
  from the plan and why (only if a link supports "why"), Unexplained (spend with no decision, decisions with no
  action, actions overdue), Questions for the next meeting. Each sentence carries a citation like
  `[D12]`, `[A KIM/17/26-11]`, `[L expense 283]`. Code verifies every citation exists in the evidence pack and
  strips sentences that fail. Cached by a hash of the evidence pack.
- A report page in the Hub and a PDF export through the existing document tooling.
- Ask KimFam: add a tool so "why did we buy the second batch?" is answered from the register with citations.

### Phase 5: hand-off to the WhatsApp agent (separate repo; later)
Out of scope for this change. Note in the ADR that the agent can later ask "who decided this?" using the same API.

## Definition of done (per phase)
- Unit tests green (synthetic data), `python -m compileall` clean, front-end `tsc` and `eslint` clean.
- ADR-034 and the `docs/architecture.dsl` component added in the same change.
- No real names, money figures or transcript text anywhere in the diff.
- The repo's existing tests still pass.
- A short report: what changed, checks and their results, what is left.

## Acceptance (the maintainer checks these on real data after merge)
1. Pick a club refund to a member: the trace shows the decision to restock, who said it, the quote, the action,
   and the ledger rows it relates to, or says plainly that no decision was found.
2. Pick the second-batch purchase: same.
3. The report for the chicken project cites only ids that exist and ends with an honest "Unexplained" list.
4. A meeting without speaker labels shows quotes as unattributed, never guessed.
