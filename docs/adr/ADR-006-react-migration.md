# ADR-006: React 18 + TypeScript Frontend Migration
## Status: Accepted

## Context
KimFam Hub frontend was a 5,413-line monolithic `index.html` with all logic inlined. This caused:
- Phone-only layout forced onto all screen sizes (no responsive breakpoints)
- No type safety; runtime bugs only surfaced in production
- No i18n capability (majority of club members speak Kiswahili or Runyankole)
- Impossible to split work across features without merge conflicts
- No code-splitting; full 5K-line parse on every page load

## Decision
Replace `index.html` with a Vite + React 18 + TypeScript SPA.

Stack choices:
- **Vite**: fastest dev cycle, native ESM, tree-shaking by default
- **React 18**: chosen over Vue for future React Native mobile compatibility
- **TypeScript**: strict mode catches API contract mismatches at compile time
- **Tailwind CSS v4** (`@tailwindcss/vite` plugin): responsive prefixes (`md:`) fix the desktop layout; dark theme via CSS custom properties
- **React Router v6**: file-based routes, `<Navigate>` for auth guard
- **TanStack Query v5**: 30s stale-time, `queryKey`-based invalidation on mutations
- **react-i18next**: 3 locales (en, sw, rny), persisted to localStorage, LanguageDetector
- **FastAPI SPA fallback**: `/{full_path:path}` catch-all serves `dist/index.html`

## Consequences
Better: responsive layout (desktop sidebar, mobile bottom tab bar), type safety, i18n, code-splitting, testable components, parallel feature development.
Worse: CI build time increases by ~15s (npm ci + npm run build). Node.js must be installed on the CI runner (ubuntu-latest already has it).
Watch: `verbatimModuleSyntax` requires `import type` for type-only imports; fail fast via `tsc -b` in build script.

---

## Addendum: Mobile Navigation Design (2026-06-10)

### Decision
Mobile layout uses a fixed bottom tab bar with 5 pinned tabs plus a hamburger button that opens a full slide-in drawer containing all tabs.

Pinned tabs: Home, Finances, Updates, Projects, Ask KimFam.
Drawer contains all tabs including Actions, Members, Equity, Loans, Meetings, Documents, and Admin (admins only).

### Rationale
Usage data (as of June 2026): 9 of 13 members have logged in. The 5 pinned tabs cover the daily touchpoints. Finances and Ask KimFam rank as the highest-utility features for regular members. Actions, Meetings, and Documents are less frequent and belong in the drawer.

Showing all 12 tabs in a scrolling bottom bar was discarded: it is cognitively overwhelming and requires horizontal scrolling on small phones. Showing only the drawer was discarded: it hides Ask KimFam (the highest-engagement feature) one tap deeper than it should be.

The 6th slot in the bottom bar is the hamburger (labeled "More"), not a 6th tab, to make the drawer discoverability explicit.

### Implementation
`BOTTOM_TABS` constant in `Nav.tsx` lists the 5 pinned routes. Tabs are filtered from the full `TABS` array, so icons and labels are defined in one place.
`AppShell.tsx` sets `paddingBottom: 76px` on mobile (60px bar + 16px content margin) so page content never hides behind the bar.
