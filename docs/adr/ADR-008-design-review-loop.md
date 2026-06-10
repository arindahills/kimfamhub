# ADR-008: Automated Claude↔Gemini Design Review Loop

## Status: Accepted

## Context
Design iteration relied on the human manually screenshotting staging on a phone, pasting the image into Gemini for critique, then pasting the critique back to Claude. Slow, lossy, and human-bottlenecked. We wanted a tight build→review→fix loop that does not require the human until final sign-off.

## Decision
Add `tools/design-loop/design_review.py`: headless Playwright logs into staging at an iPhone viewport, screenshots a route, and sends the PNG to Gemini for a critique against `docs/design-system.md`. Claude reads the screenshot directly (native image reading) as the primary signal and uses Gemini's critique as a filtered second opinion, then implements, redeploys to staging, and re-runs — surfacing to the human only for approval. Secrets live in a gitignored `.env`; output in gitignored `out/`.

## Consequences
Better: design iterations no longer need the human to capture/transfer screenshots; Claude can self-review visually; critique is grounded in our own spec.
Worse: another tool + venv to maintain; Gemini's prose over-claims, so its critique must be filtered against what the screenshot actually shows (it cannot be trusted blindly).
Watch: nano-banana mockup generation returns `429 limit:0` on the free Gemini tier — improved-mockup images need a paid tier; the free path is text critique only. The script retries transient 429/503 and never blocks on Gemini failure (the screenshot is the load-bearing output).
