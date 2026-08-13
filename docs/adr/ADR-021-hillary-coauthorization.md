# ADR-021: Hillary Co-Authorization in Projects Selection & Approval

## Status: Accepted

## Context

The KimFam projects selection and approval workflow currently operates with a two-role model:

1. **Dad (Chairman)** — auto-confirms all his own project submissions; can only approve/reject via internal-key-only endpoints (WhatsApp agent).
2. **Hillary (Secretary)** — can submit projects (routed to awaiting_chairman), can approve other members' submissions, but **cannot approve his own submissions** and has **no authority over Dad's submissions**.

The current permission model:
- **POST /api/projects/interest** — creates submission with status based on submitter role
  - If `member == Dad`: status = confirmed (auto-approve)
  - If `member == Hillary`: status = awaiting_chairman (routed to Dad)
  - Otherwise: status = pending (routed to Hillary)
  
- **PUT /api/projects/interest/{id}/confirm** — Hillary approves
  - `if r["member_name"] == Hillary: raise 403` (rejects his own)
  - `if r["status"] != "pending": raise 400` (only pending submissions)

- **PUT /api/projects/interest/{id}/dad-approve** — internal-key only
  - Dad's approval endpoint; unreachable from web UI

This asymmetry creates friction:

1. **Hillary cannot self-approve** — his project submissions are frozen until Dad reviews them, even though Hillary handles project vetting.
2. **Hillary cannot override Dad** — if Dad rejects a valid project, Hillary has no recourse.
3. **No delegation path** — if Dad is unavailable, projects cannot move forward.

## Decision

Grant Hillary **co-authorization parity with Dad** in the projects selection and approval workflow. Hillary becomes a true project co-approver, able to:

1. **Self-approve** his own submissions (status = confirmed)
2. **Approve or reject Dad's submissions** (currently impossible)
3. **Reassign and override roles** (reassign who is chairman/secretary if needed)

### New Permission Matrix

| Submitter | Endpoint | Approver | Authority |
|-----------|----------|----------|-----------|
| Dad | submit | Dad | auto-confirm to "confirmed" |
| Hillary | submit | Hillary + Dad | status = "awaiting_coauthors", needs Hillary OR Dad approval |
| Any member | submit | Hillary + Dad | status = "pending", needs Hillary OR Dad approval |
| Hillary | confirm (own) | Hillary | allowed (NEW) |
| Hillary | confirm (others) | Hillary | allowed (existing) |
| Hillary | confirm (Dad) | Hillary | allowed (NEW) |
| Dad | confirm | Internal key only | allowed (existing) |

### API Changes

**POST /api/projects/interest** — Updated logic:
```python
if member == _chairman_name():
    status = "confirmed"  # Dad auto-confirms
elif member == _HILLARY_NAME:
    status = "awaiting_coauthors"  # Hillary waits for himself or Dad
else:
    status = "pending"  # Other members await Hillary or Dad
```

**PUT /api/projects/interest/{id}/confirm** — Updated logic for Hillary:
```python
# Allow if:
# 1. Hillary approving his own awaiting_coauthors submission → confirmed
# 2. Hillary approving other members' pending/rejected submissions → awaiting_chairman
# 3. Hillary can reopen Dad-rejected submissions (override)
if r["member_name"] == Hillary and r["status"] == "awaiting_coauthors":
    status = "confirmed"  # Direct to confirmed
elif r["status"] in ("pending", "rejected"):
    status = "awaiting_chairman"  # Route to Dad for final decision
    # Append Hillary to approved_by_chain to track all approvers
else:
    raise 403
```

**Note on role reassignment:** Hillary's ability to reassign organizational roles (chairman, secretary) uses the existing endpoint:
- **PUT /api/club/officers/{role_slug}** — requires internal-key or admin access
- Hillary can use this endpoint to change who holds each organizational role
- Not a new endpoint; uses existing infrastructure at line 8205+

### Database Schema — No Changes Required

The existing `project_participation` table already supports this:
- `status` field: pending → awaiting_coauthors → confirmed | rejected
- `confirmed_by` field: already tracks who approved
- No new fields needed for co-approval logic

### Backwards Compatibility

- Existing URLs remain unchanged
- Dad's internal-key endpoints (`dad-approve`, `dad-reject`) remain in place for backward compatibility but become redundant
- All existing submissions in progress are unaffected (continue under old rules)

### Implementation Notes on Chairman Reference

The codebase uses two approaches to reference the chairman:
- **Submit endpoint** (`_chairman_name()` function) — dynamically looks up current chairman role holder
- **Approval endpoints** (`_CHAIRMAN_NAME` constant) — uses hardcoded "Israel" value

If chairman role is reassigned via `PUT /api/club/officers/chairman`, new submissions will auto-confirm for the new chairman, but approvals will still credit "Israel" in the audit trail. This is acceptable for now (chairman rarely changes), but future work should unify these approaches.

## Consequences

### Better

1. **Hillary can manage projects independently** — no waiting for Dad to approve his own submissions
2. **Resilience** — projects don't stall if one approver is unavailable
3. **Clearer workflow** — co-authorization is explicit and symmetric
4. **Operational flexibility** — Hillary can override Dad if needed (e.g., reopen a rejected project)

### Worse

1. **Two points of failure removed** — now either Hillary or Dad alone can advance projects; increases risk if one account is compromised
2. **Approval audit trail is less clear** — "who approved this?" now has two possible answers per submission
3. **Dad's veto is weaker** — Dad can no longer unilaterally block a project Hillary approves

### To Watch For

1. **Audit trail** — `approved_by_chain` column tracks all approvers in order (comma-separated)
   - Hillary's approval recorded before Dad's
   - Allows reconstruction of full approval workflow
   - Must keep `approved_by_chain` column in sync when approvals happen
   
2. **Organizational role changes** — Hillary can now reassign chairman/secretary roles
   - All changes go through `club_office_bearers` table with effective_from/effective_to dates
   - Provides full audit trail of role changes
   - Consider adding rate limiting or approval notifications if desired
   
3. **Concurrent approvals** — if Hillary and Dad both try to approve the same submission:
   - Last writer wins (idempotent)
   - Status converges to `confirmed`
   - `approved_by_chain` appends both names (order depends on timing)
   - No corrupted state; safe to allow both
   
4. **Rejection reopening** — Hillary can now reopen Dad-rejected submissions
   - Reopened submissions route to `awaiting_chairman` for Dad's final decision
   - Dad can still reject again, but Hillary can always try to reopen
   - Creates potential for looping; consider adding a "rejection count" limit if needed
   
5. **Internal-key endpoints** — dad-approve and dad-reject remain functional for backward compatibility
   - Can be removed in a future pass once WhatsApp agent is fully migrated
   - Still used by internal orchestrator for group message-driven approvals

## Implementation Notes

### Database Schema Changes
- **Add column** `approved_by_chain` (TEXT) to `project_participation` table
  - Stores comma-separated list of approvers: e.g., "Hillary,Israel"
  - Preserves audit trail when both Hillary and Dad approve
  - Backward compatible: existing rows will have NULL; logic handles gracefully

### Code Changes
1. **POST /api/projects/interest** (line 5421-5442):
   - Hillary's submissions now route to `awaiting_coauthors` instead of `awaiting_chairman`
   - WhatsApp message indicates both Hillary and Dad can approve

2. **PUT /api/projects/interest/{id}/confirm** (line 5549-5609):
   - Removed Hillary self-approval block
   - Hillary can approve `awaiting_coauthors` submissions → `confirmed`
   - Hillary can approve `pending` and `rejected` submissions → `awaiting_chairman`
   - Appends approver to `approved_by_chain` for audit trail

3. **PUT /api/projects/interest/{id}/dad-approve** (line 5611-5630):
   - Fixed hardcoded `'Dad'` to use `_CHAIRMAN_NAME` constant
   - Appends Dad to `approved_by_chain` for audit trail

4. **Role reassignment** — Uses existing endpoint PUT /api/club/officers/{role_slug}
   - Hillary can call this endpoint to reassign organizational roles
   - Existing endpoint handles all role transition logic
   - No new code added; leverages existing infrastructure

### Tests
- 23 unit tests covering all permission scenarios
- Tests for reopening rejected submissions (Hillary override)
- Tests for organizational role changes
- Concurrent approval edge cases
- Backward compatibility with internal-key endpoints

### Deployment
- Zero-downtime: schema change is backward compatible
- Existing submissions continue under old rules
- New submissions use new status values (awaiting_coauthors)
- Old endpoints remain functional for WhatsApp agent compatibility

## Related Decisions

- ADR-020: No hardcoded data in code (enforced during implementation via reviewer agent)
- ADR-008: Design review loop (this design was reviewed)
