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
