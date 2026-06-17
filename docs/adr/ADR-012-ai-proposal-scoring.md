# ADR-012: AI Proposal Scoring, Support-Readiness & Versioning

## Status: Accepted (2026-06-17)

## Context
KimFam evaluates project proposals (chicken, washing bay, Kakoba real estate, etc.)
informally in meetings. The club already has a written standard, Hillary's "Project
Management and Documentation" deck defines a **Project Proposal Template (Key Areas to
Address)** and an investment & **reward guidelines** doc, but there was no consistent,
guided way to (a) check a proposal against that standard, (b) tell a proposer exactly
what is missing, (c) decide whether the proposal is ready to receive the support it
asks for, or (d) track refinement across versions. Proposal docs sat unscored in the
Documents repo with no ownership or evaluation.

## Decision
Add a **Proposals** feature with AI scoring grounded in the club's own framework.

- **Scoring matrix = the club's template.** Nine criteria mirror the Key Areas to
  Address exactly: Background & Introduction, Objective, Scope, Stakeholders,
  Resources & Budget, Timeline/Milestones, Risk Management, Financial Appraisal
  (Payback/ROI/NPV, weighted highest at 20), Benefits. Each scored 1-5, weighted to /100,
  with a verdict band (Strong / Viable with conditions / Needs work / Not ready).
- **Claude only.** Scoring uses the Claude CLI exclusively (no DeepSeek/Groq fallback),
  with the project-management deck and the reward guidelines passed in as authoritative
  context so the model reasons against the family's actual standard (cached).
- **Support-readiness.** The model also extracts the support the proposer requests and
  judges whether the proposal is in shape to receive it, listing what must be provided
  first. This is the gate between "scored" and "approved".
- **Ownership.** Every proposal has an `owner` (the family/member it belongs to, e.g.
  the Arungas) distinct from `submitted_by` (the uploader), so Hillary can upload on a
  member's behalf without taking ownership.
- **Versioning / archiving.** A new upload for the same owner+title (or explicit
  `supersedes`) becomes the next version; prior versions are archived (`is_current=false`)
  under a `thread_id`. Files are stored per version (`projects/Proposals/<title>/v<n>`),
  so progress across refinements is preserved and each version's answered/missing/blocking
  is visible, guiding what the next version must address.
- **Storage & reuse.** Proposal files go to R2 `projects/Proposals/` (so they also appear
  in the Documents repo) and into the docs folder for RAG embedding. The flow is generic:
  it works for every current and future project.
- **Streamed scoring (SSE).** Scoring takes ~40-60s; a plain request was dropped by the
  browser at the ~60s idle cutoff ("failed to fetch"). Upload + (re)score now stream stage
  events (`_ai_score_stream`) so the connection stays alive and the user sees live progress,
  like Ask KimFam. See ADR-013 for the reusable pattern.
- **Exact-duplicate guard.** A SHA-256 of the file bytes (`file_hash`) blocks re-uploading a
  byte-identical file (survives a rename, changes on any edit), with a 409 naming the existing
  one. Owner+title still drives versioning. The new/revision selector makes intent explicit.
- **WhatsApp notifications.** On submission the **owner** (a family -> its members, or the
  member) plus the submitter get a personal WhatsApp confirmation with a link ("submitted by X
  on your behalf" when applicable). The family **group** is NOT pinged automatically; a
  deliberate `POST /api/proposals/{id}/share` ("Share to family group" button) posts a
  ready-for-review announcement. Reuses the notifications bridge; staging-safe via `KIMFAM_ENV`.
- **Links are URL-encoded.** Proposal paths contain spaces; both the in-app and WhatsApp links
  `encodeURI`/`quote` the path and target `/view` so they resolve (an unencoded space truncated
  the request and 404'd).

Endpoints: `POST /api/proposals` (upload + score, SSE), `GET /api/proposals` (current
versions, each with version history), `GET /api/proposals/{id}`,
`POST /api/proposals/{id}/score` (SSE), `POST /api/proposals/{id}/share`,
`GET /api/proposals/matrix` (rubric + weights). Table: `proposals` (scores,
support_requested, readiness, file_hash, thread_id, version, is_current, uploaded_at,
all additive).

## Consequences
- **Better:** proposals are evaluated consistently against the family's own standard;
  proposers get concrete, prioritised guidance; ownership and refinement history are
  explicit; the same engine grades legacy and future proposals; files stay integrated
  with the document repo and Ask KimFam.
- **Worse / watch:** scoring takes ~40-60s per proposal (Claude on the framework context),
  acceptable for an occasional action and covered by the 1800s timeouts. Claude-only means
  no automatic fallback, if the CLI is down, scoring returns busy (the record is still
  saved unscored and can be re-scored). The model's scores are advisory, not a vote;
  approval remains a human/family decision.
- **Done since:** versions group into one card with a version-history showing the score
  progression (delta per version); a "How scoring works" matrix view exposes the rubric;
  SSE progress; content-hash dedup; owner + group WhatsApp notifications.
- **Pending:** a richer criterion-level resolved-vs-outstanding diff between versions, and a
  separate "live project vs framework + reward guidelines" alignment view for projects that
  have gone operational.
