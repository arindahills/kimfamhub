# ADR-007: Premium Dark Design System

## Status: Accepted

## Context
The React migration shipped a structurally-complete app whose visual layer felt "ordinary" and inconsistent: neon-ish borders, dark-on-dark over-saturation, cramped spacing, desktop-style modals on mobile, and per-page ad-hoc inline styles. The original vanilla app had a more polished, coherent look that users trusted. A Gemini-authored UX critique (`kimfam_hub_redesign_spec.pdf`) crystallised the target: a premium dark mobile ecosystem. We needed one canonical visual language applied to every screen, not per-page improvisation.

## Decision
Adopt a token-driven design system, documented canonically in `docs/design-system.md` and implemented as shadcn/Radix-style primitives in `frontend/src/components/ui/` with CSS-variable tokens in `index.css`.

Core rules (full spec + amendment log in `docs/design-system.md`):
- **Depth over contrast.** Canvas `#121824`, cards `#1E293B`, inset `#161E2B`; hierarchy via shade, not borders/neon. Subtle hairline borders only.
- **Inter** typeface; titles 15px bold white, metadata muted silver.
- **Colour with intent (Rev 2).** Multicolour project + nav icons with a soft themed glow behind the icon; metric panels colour-themed by venture category (agriculture green, business water-blue, etc.). Colour for identity/recognition; controls stay Lucide line icons.
- Low-saturation status pills (title-cased), uniform 8px outline buttons, the Interest action demoted to a secondary inline control, Team Interest as a collapsed-by-default accordion, media in uniform square frames with a `+X` overlay.
- **Mobile bottom-sheet modals (Rev 3)** — all overlays slide up from the base with custom controls (segmented pills, custom checkboxes); centred dialog only on desktop.

The system was built and validated screen-by-screen on staging (prod-mirrored DB) before any prod merge, starting with Projects as the reference screen.

## Consequences
Better: one consistent, premium look across the app; spacing/colour changes are centralised (one token edit propagates everywhere); mobile-correct modals; a written, defensible record (Rev 1→3 amendment log) of why each decision was made.
Worse: added dependencies (Radix primitives, lucide-react, Inter web font) and a larger JS bundle (~75KB → ~180KB). A short-lived inconsistency window while the system is rolled across the remaining screens.
Watch: every new screen MUST follow `docs/design-system.md` (enforced via CLAUDE.md capability rule + hot_kimfam.md runbook). nano-banana mockup generation needs a paid Gemini tier; the free critic path is text-only.
