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

Endpoints: `POST /api/proposals` (upload + score), `GET /api/proposals`,
`GET /api/proposals/{id}`, `POST /api/proposals/{id}/score`. Table: `proposals`
(scores, support_requested, readiness, thread_id, version, is_current, all additive).

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
- **Pending:** a cross-version progress-delta view (resolved vs still-outstanding between
  v1 and v2), and a separate "live project vs framework + reward guidelines" alignment
  view for projects that have gone operational.
