# ADR-034: Decision trace - a register of decisions with quotes, linked to actions and money

## Status: Accepted

## Context
Every figure in the Hub can be traced to a ledger row, but not to the decision behind it. The family wants
to press **Why?** on a figure and see what was agreed, who said it, in which meeting, and what followed
(docs/specs/decision-trace.md). The raw material exists: meeting transcripts (the recent ones),
minutes and key decisions, actions, and the project ledger (ADR-032). What is missing is a structured,
checkable register that joins them. The standing rules are strict: never invent attribution, no
generated claim without a citation, money links are confirmed by people, private meetings are never used.

## Decision
Accepted 2 Oct 2026. Phases 0-3 are built (register, extraction, link suggestions, admin review, trace API and Why? UI, issue #101). Phases 4-5 (report, Ask KimFam tool, WhatsApp hand-off) are separate (#102).

1. **Three new tables**, created on demand under a Postgres advisory lock like `ledger.ready()`:
   `decisions` (statement, rationale, verbatim quote and its character offset, speaker or NULL, amount,
   status, confidence, review state, source `transcript` or `minutes`) and `decision_links`
   (decision to action, ledger row, treasury payment, ... with relation and state `suggested`,
   `confirmed` or `rejected`). Uniqueness on (meeting, quote offset, statement) and on
   (decision, target, relation) makes every insert idempotent. `ready()` creates ONLY tables the app role
   owns (`decisions`, `decision_links`, `decision_private_meetings`). `meetings` and `actions` are owned by
   the `postgres` role, so `meetings.is_private` and the `actions(meeting_id)` index are attempted
   best-effort in their own transactions (check `information_schema` first, log and continue on failure,
   as `_ensure_meeting_cols` does). The override table `decision_private_meetings(meeting_id, set_by,
   set_at)` is authoritative: a meeting is private if the column OR the table says so, and every read
   works when the column does not exist (probed once, cached, missing = not private).
2. **Extraction is a model proposal followed by code that does not trust it** (`decision_trace.py`).
   The model call is an injected `model_fn(prompt) -> str`, so all tests run offline. `check()` keeps a
   decision only if its quote is found verbatim in the stored transcript (whitespace-normalised), the
   project is known, the statement is bounded and the amount and date parse. A speaker is recorded only
   when the transcript itself labels the turn containing the quote with a known member; otherwise NULL
   ("unattributed"). Meetings without a transcript fall back to their key-decision bullets
   (`source='minutes'`, no quote, no speaker, low confidence).
3. **Private meetings are skipped before the transcript is read**, and never shown or linked: every
   read (store, register route, link candidates, existing links) excludes them. An admin-only
   `POST /api/decision-register/meetings/{id}/private` sets or clears the override row; flagging also
   soft-deletes the meeting's decisions. Projects come from `PROJECT_NAMES` (now in `project_names.py`,
   shared with `main.py`); an empty list is a status `error`, never a silent drop. Minutes-only bullets
   are tagged to one project by conservative keywords and not stored if untaggable. A quote that occurs
   more than once in its chunk (or in the transcript when no chunk is given) gets speaker NULL; quote
   matching ignores whitespace and curly-vs-straight quotes; a carry-over sentence in the prompt is context
   only and never matched.
4. **AI proposes, people confirm.** `suggest_links` scores candidates (same-meeting actions with keyword
   overlap; ledger and treasury rows dated 0-45 days after the meeting with an amount equal or within 5
   percent, or keyword overlap; when several rows match one amount each suggestion is capped at 0.5) and stores them as `suggested` only. A rejected link is never suggested
   again. Admins confirm, reject or add a link by hand through `/api/decision-register/*`
   (admin JWT only; the internal key is accepted on the read-only list route and nowhere else; registered before the ledger routes and the SPA catch-all).
5. **Phase 0 audit** (`scripts/decision_audit.py`) prints a per-meeting coverage table (counts and
   fractions, no text) so the maintainer can see how many meetings can be attributed to a speaker.
6. Claude is the engine (the Hub's existing `_ask_claude` helper wired in by the caller that runs
   extraction on the server); Gemini only as fallback. This change does not call a model itself.

7. **Trace API and Why? panel (phase 3).** `GET /api/trace/{project_id}?target_type=&target_ref=` returns the chain
   for a target (`ledger_expense|sale|stock|loss`, `treasury_payment`, `open_item`, `action`): the linked decisions
   (confirmed links as confirmed, suggested ones flagged `suggested`, rejected hidden; never from a private meeting),
   each with statement, rationale, status, review state, speaker or null (shown as "unattributed"), meeting ref and
   date and the verbatim quote with up to 2 transcript lines of context either side, cut from the stored transcript
   at `quote_start` by the pure `quote_context()` (the transcript itself is never returned; no offset or an offset
   outside the text means no quote, nothing is guessed); the linked actions with owner, deadline, status and dated
   updates; and the outcome rows (ledger or treasury rows the decisions link to, with a total).
   `GET /api/trace/{project_id}/decisions` lists the register for members (non-rejected links, non-private meetings).
   Both need a login (any member); the internal key may read. Admins review through
   `POST /api/decision-register/decisions/{id}/review` with `{state: confirmed|corrected, statement?}`, which sets
   `review_state`, `reviewed_by`, `reviewed_at` (and the corrected statement) with a committed write; admin JWT only.
   All routes are registered before the ledger routes and the SPA catch-all. In `LedgerPage.tsx` a Why? button sits on
   Entries rows, Reconciliation open items and drill-down lines and opens a timeline panel (bottom sheet on a phone)
   with "unreviewed" and "suggested" badges and an admin confirm or correct control; a Decisions tab lists the
   register grouped by meeting.

8. **Smart report (phase 4).** `report.py` writes a cited narrative; code, not the model, decides what may be said.
   `build_evidence_pack` (pure) assembles ordered items with stable ids from data passed in: decisions `[D12]`
   (statement, rationale, status, review state, meeting ref and date, speaker or "unattributed", amount), actions
   `[A KIM/17/26-4]` (owner, deadline, overdue flag, dated updates), ledger rows `[L expense 283]`, club payments `[T 35]`,
   scorecard KPIs and findings `[S revenue]`, and unexplained reconciliation items `[O gps:missing]`. Only confirmed or
   suggested links are used, each suggested link is marked as such in the pack and the prompt, and private meetings are
   excluded by the readers that feed it. `build_prompt` asks an injected `model_fn` (prompt to text; Claude through the
   Hub's `_ask_claude`, a fake in tests) for six sections: Summary, Timeline of decisions, What it cost and what it earned,
   Where reality departed from the plan and why, Unexplained, Questions for the next meeting.
   `verify_report` splits the text into sentences and **removes** (never softens) any sentence with no citation or with a
   citation not in the pack; it also removes a sentence that names a speaker, or attributes speech, for a decision whose
   speaker is not set. The result is the cleaned sections plus the list of what was stripped. `pack_hash` is a stable
   SHA-256 of the pack.
   Reports are stored in the app-owned `decision_reports` table (project, pack hash, body JSONB, stripped JSONB, creator,
   time), created under an advisory lock like the register; writes use `db.execute` (committed), never `db.query`.
   `GET /api/trace/{project}/report` (any member) returns the cached report when its hash matches the current data, or
   `stale: true` with the last one, and never generates. `POST` (admin JWT only, not the internal key) builds the pack,
   calls Claude, verifies, stores and returns; a failed model call is a 503 and stores nothing. Both routes are registered
   before the ledger routes and the SPA catch-all. Everyone sees the count of stripped sentences; their text is admin only.
   The Report tab in `LedgerPage.tsx` shows each section with tappable citation chips (Why? panel for D, A, T, O, L; the
   Scorecard tab for S), the generated time, a stale badge, a Generate or Refresh button for admins and a print stylesheet.
   The trace API gained a `decision` target so a `[D12]` chip can open that decision with its quote.
   **Ask KimFam** has a `decision_trace` tool: it reads the register through the internal key and answers "why" questions
   only from matching decisions, with `[D..]` citations and linked items, and says plainly when nothing is recorded.

## Consequences
- Every quote in the register is provably present in the stored transcript; a model that hallucinates
  loses the decision rather than corrupting the record.
- Meetings with unlabelled transcripts (older ones, or speaker ids that are not member names) yield
  unattributed quotes, never guessed ones. Diarised labels such as "Speaker 2" are not names and stay
  unattributed until a person maps them.
- Money links stay "suggested" until an admin confirms, so the trace never presents a guess as fact.
- Extraction is a batch the maintainer runs; nothing is scheduled yet. Re-running is safe.
- The register lives in the production database; this public repo holds only code and synthetic tests.
- Later phases read the same tables: the trace API and Why? panel, the cited report, and (phase 5) the
  WhatsApp agent asking "who decided this?" through the same API.
- Flagging a meeting private is reversible: unflagging restores the decisions that flag purged (deleted at or after it was set). The audit script honours the override table.

### Amendment (5 Oct 2026): what the report verifier guarantees, and what it does not
After independent review the verifier removes a sentence when: it has no citation or an unknown one; it contains a number
that the cited evidence items do not contain (so an invented amount cannot ride on a real citation); it attributes speech
(said, proposed by, ...) with no recorded speaker on a cited decision; or it names a member or an office (Chairman,
Treasurer, manager, Dad, ...) and credits them with an act or statement the cited decision does not attribute to them.
A citation proves that the item exists and that the numbers agree. It does not prove the sentence means what the item
says, so the report is a reading aid with links to the evidence, and anything important is checked through the chips.
Evidence text is untrusted: brackets and heading marks are removed from it and it is fenced in the prompt as data. Only
the newest 10 stored reports per project are kept.

### Amendment (6 Oct 2026): who a speaker is, per meeting (issue #106)
Audio transcripts are diarized ("Speaker 1", "Speaker 2") and carry no names, so attribution by label equals name almost
never fired. The decision keeps the raw label (`decisions.speaker_label`); the member is resolved at display time from
`meeting_speakers` rows whose state is `confirmed`. Rules:
1. **Identity is never inferred from the logged-in account, the IP or the device.** Some members share one device and one
   login, so none of those says who spoke. Code never reads them as evidence (they are used only to decide who may confirm).
2. **The mapping is per meeting and confirmed by a person.** `PUT /api/meetings/{id}/speakers/{label}` is allowed for an
   admin or a member on that meeting's attendance list, JWT only (the internal key is refused). The confirmer is recorded and
   a change keeps the old value in `speaker_map_log`. The member must be an attendee when attendance is known.
3. **Shared state.** A pasted named transcript (for example from Tactiq) carries the display name of the account that joined
   the call, so one name can cover several voices. When a name aligns with two or more diarized labels, each is `shared`; a
   person may also mark a label shared by hand. A shared label never names a person; the UI says "shared device".
4. **Tactiq is corroboration, not proof.** `speaker_map.align` matches diarized and named turns by token overlap and rough
   position and `suggest` turns the counts into a proposal ("14 of 15 overlapping lines say X") that is only ever
   `suggested`, `shared` or `unknown`. Nothing automatic produces `confirmed`; below the evidence floor the answer is unknown.
5. **Display.** `trace()` and `register()` return `speaker_label`, `speaker` (the confirmed member or null) and
   `attribution` (`confirmed`, `shared`, `unattributed`). The report evidence pack uses the confirmed member only, so
   `verify_report` still removes any sentence naming who said something unless the pack's speaker is set.
6. **Storage** is app-owned (`meeting_speakers`, `speaker_map_log`, created under an advisory lock; the `speaker_label` column
   is added in its own transaction). Private meetings are excluded everywhere. Backfills (`scripts/speaker_backfill.py`) set
   labels on existing decisions and create suggested rows; both are idempotent and never confirm.
7. **Follow-up, not built:** audio clips of each voice would help a person decide, but audio is not stored today, so none is offered.

### Amendment: Tactiq export format and name labels (6 Oct 2026)
- A pasted Tactiq export is not "Name: text". Each turn is the display name on a line of its own with the speech on the lines below. `speaker_map.tactiq_names` and `tactiq_turns` read that format (a name is a recurring short line in Title or UPPER case, or one that matches a member).
- Alignment has a second pass for long diarized turns: each named line fully contained in the turn, at about the same relative place in the meeting, is one vote for that name.
- A name is shared only when it is the leading name of two or more voices. A few stray votes for another name do not make a voice shared.
- Display names such as a club or family login are exactly the shared-device case: one name over several voices. They are shown as shared, never as a person.
- Name labels from a pasted transcript can be confirmed, marked shared or marked unknown in the same review panel as Speaker N labels. Meetings whose audio was transcribed without speaker labels have only name labels to review.
- Flagging a meeting private deletes its speaker map rows, which hold sample lines.
- Unflagging a private meeting restores its decisions but NOT its speaker confirmations: the map rows and their history are deleted on flag and must be confirmed again.
- When a meeting has no attendance list, any logged-in member may confirm a label and the picker offers every member; with a list, only an admin or an attendee may, and only attendees can be picked.
- A name line is a header only when it is Title or UPPER case over two to four words, or begins with a member's name. A phrase that merely mentions a member (a greeting or thanks) is speech. Greeting words never start a name.
- Display names that are not a member's own name (for example a nickname on a chat login) are recorded as aliases in `speaker_aliases` by a person, never in code. An alias only ever produces a suggestion, and only for an attendee. A shared club or family login name is never aliased.
