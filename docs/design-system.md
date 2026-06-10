# KimFam Hub — Design System (canonical)

> Source of truth for the app's look and feel. Derived from `kimfam_hub_redesign_spec.pdf`
> (UX/UID Redesign Specification, Project Portfolio & Venture Directory) + the approved Gemini mockup.
> **Every screen must follow this.** When building or editing any page, match these rules.

## Philosophy: Depth over contrast

Premium dark ecosystem. Convey hierarchy through **shade variation**, not heavy borders or
neon. Deprecate absolute blacks and stark/saturated blues. Reduce eye strain in long review
sessions. Calm, enterprise-grade, not amateur.

## Color tokens

| Token | Hex | Use |
|---|---|---|
| `--background` (canvas) | `#121824` | App background |
| `--surface` | `#1A2230` | Slightly raised areas (nav bars, headers) |
| `--card` | `#1E293B` | Standard container card |
| `--card-inset` | `#161E2B` | Inset panels inside a card |
| `--foreground` | `#F1F5F9` | Primary text (titles) |
| `--muted` | `#94A3B8` | Secondary text |
| `--muted-2` | `#64748B` | Tertiary / metadata (muted silver) |
| `--border` | `#27303F` | **Subtle** hairline only — prefer shade contrast over borders |
| `--primary` | `#3B82F6` | Restrained accent |
| `--success` | `#22C55E` | Positive (used as low-sat tint, not loud fill) |

**Status pills** use low-saturation tints: background `color @ ~12%`, text a soft/light variant,
border `color @ ~25%` or none. Never loud neon borders. Example (Operational): bg
`rgba(34,197,94,.12)`, text `#6ee7b7`.

## Typography

Font stack: `'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif`.
Inter loaded via `<link>` in `index.html`.

| Role | Size | Weight | Color |
|---|---|---|---|
| Card title | 15px (~14pt) | 700 | `--foreground` (crisp white) |
| Category / metadata / manager | 12px (~10.5px) | 400–500 | `--muted-2` (muted silver) |
| Hero metric | 15–16px | 700 | accent (e.g. mint on green tint) |
| Micro-label (UPPERCASE) | 10px | 700, tracking `0.08em` | `--muted-2` |
| Body / values | 13px | 400–500 | `#cbd5e1` |

Money: `tabular-nums`. Generous baseline tracking on hero metrics.

## Components

**Card** — `--card` bg, radius `16px`, **no hard border** (use shadow + shade). Optional very
subtle inner top highlight. Soft shadow `0 4px 20px rgba(0,0,0,.28)`. Generous internal padding
(16px), distinct vertical spacing between blocks so secondary text never collides with bounds.

**Status pill** — inline, next to the title (not floating top-right corner). Dot optional. Low-sat
tint per status. Title-cased label.

**Action buttons** — uniform **8px radius**, equal width, **outline/flat** style (transparent or
`--card-inset` fill, `--border` outline, `--foreground` text). Analysis / Audit / Show Details are
a paired inline set. **Do not** make any of them a loud filled block.

**+ Interest / + Express Interest** — **demoted** to an elegant **secondary inline** action (small,
outline or ghost, accent text), placed in the Team Interest header. Never a full-width filled green
primary; it must not pull attention from the data.

**Accordion (Team Interest, and similar secondary lists)** — collapsible, **collapsed by default**.
Header shows `► Title (count)` plus the secondary action. Rows reveal on expand only. Keeps
dashboards focused on high-level stats.

**Media blocks** — images anchored in **uniform rounded square frames** (identical aspect, e.g.
`aspect-square`, radius `10px`, subtle border). When a stack has **more than 3** assets, show the
first 3 (or 4) and a final **`+X` counter** tile instead of a ragged scroll.

**Filter pills (page header)** — segmented pills with **generous gap** (never tight); active pill is
a lighter filled `--surface`, inactive are flat/ghost. Small monochrome Lucide icon + label.

**Bottom navigation** — **full-colour icons** (Rev 2 override of Rev 1's monochrome). Project/domain
emoji icons, as before. Active label/icon = accent; inactive = muted. Colour is intentional here for
fast recognition.

## Iconography

Two-tier (Rev 2): **Lucide line icons** for in-card *controls* (buttons, toggles, chevrons) — consistent
stroke, clean. **Full-colour emoji** for *identity & navigation*: project domain icons inside a circular
avatar tile (with a soft themed glow behind), and the bottom-nav destinations. Colour is reserved for
recognition/identity; controls stay line-style for calm.

## Amendment Log (the journey — for defence & recreation)

**Rev 1 (base spec):** depth-over-contrast slate theme; monochrome Lucide nav; status pills; accordion; uniform 8px outline buttons; +Interest demoted; +X media.

**Rev 2 (2026-06-10) — "Coherence Meets Color":** keep the structural cleanliness of Rev 1, re-introduce intentional colour that *aids navigation* rather than cluttering. Overrides parts of Rev 1:
- **Colourful icons restored.** Project domain emoji stay multicolour (chicken warm, car blue/red, mango gradient). **Bottom navigation reverts to full-colour icons** (was monochrome in Rev 1) — colour is wanted here.
- **Subtle colour glow behind the icon only** (not the card border) for depth — soft halo in the venture's theme colour.
- **Themed metric panels.** The hero metric (e.g. "60% Production Rate" bar) is colour-coded by venture **category**: Farming & Agriculture = green, Business Ventures (Washing Bay) = water blue, Unit Trusts = violet, Real Estate = amber. Aids subconscious categorisation. See `CATEGORY_THEME` in `ProjectsPage.tsx`.
- **Cleaner padding / breathable spacing.** Cards slightly taller; every element gets air; headers align (F-shape scan path); sub-details subtly indented. `Show Details` restored as the 3rd uniform button (Analysis / Audit / Details).
- Status pills, Team Interest accordion (collapsed default), and +X media standardisation from Rev 1 are **kept**.

What did NOT change: canvas `#121824` / card `#1E293B`, no neon borders, Inter type, low-saturation status pills, the accordion pattern, uniform 8px buttons, demoted Interest action.

## Anti-patterns (explicitly rejected)

- Loud neon/saturated borders; dark-on-dark over-saturation.
- Secondary text jammed against card edges (give vertical padding).
- Inconsistent button radii; an over-intense filled CTA absorbing the metric matrix.
- Raw status tokens like `awaiting_chairman` — always title-case ("Awaiting Chairman").
- Camera-crop images in compressed/uneven aspect ratios.
- Colour on *card borders* or as neon outlines (colour belongs on icons, glows, and themed metric
  panels only — never as a loud structural border).
