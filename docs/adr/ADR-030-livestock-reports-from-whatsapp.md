# ADR-030: Livestock reports from WhatsApp go through the tracker's own rules

## Status: Accepted (2026-09-29)

## Context
The livestock tracker (ADR-029) is only as good as its entries, and the people who handle the
animals do not use the Hub: Dad and Mum have never logged in, Solomon last did in June and has
never entered a sheep record. They do report on WhatsApp. The agent (whatsapp-agent ADR-018)
turns those messages into tracker entries; the Hub must stay the single place the rules live.

## Decision
- The livestock write and delete routes also accept the server's `X-Internal-Key` together with
  `reported_by`, the canonical member name the agent resolved from the sender's phone. The recorder
  rule is applied to that member exactly as to a login (goats: Solomon, Mum, admins incl. Dad;
  sheep: Solomon, admins). `reported_by` is ignored without the key. Entries are stamped
  "<display> via WhatsApp".
- `source_ref` (one per message part, e.g. `wa:<message id>:e0`) with a unique index per project:
  a replayed message returns the existing id **before** validation, so an agent restart can never
  record a death twice.
- A WhatsApp undo may only remove that reporter's own WhatsApp entries. Any delete of an event is
  refused (409) if it would leave an owner below zero.
- Opening counts are never written from chat without Hillary: the agent queues them and records
  them, as Hillary, only on his `>> goats confirm`.

## Consequences
- Better: reports land where the farm team already talks, with the same checks as the forms.
- Watch: the internal key now authorises livestock writes on a member's behalf; it lives only on
  the server. The agent's parsing is the new risk; see whatsapp-agent ADR-018 for its guards.
