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

**Charts (`MiniChart`)** — lightweight themed SVG (no chart-lib dependency, stays cohesive). Plots
line / bar / horizontal-reference series over shared labels with an optional break-even marker.
Y-axis labels on the **left**, compact UGX (`12M`/`350K`); subtle `--border` gridlines; sparse
series (e.g. "Actual") render as dots so they're visible; `ref` lines are dashed and shown as a dash
in the legend. Used in the project Analysis modal, adapting to whatever `chart_data`/`projection`
shape the endpoint returns (cumulative-vs-CapEx line, or yearly revenue/profit bars + cumulative line).

**Filter pills (page header)** — segmented pills with **generous gap** (never tight); active pill is
a lighter filled `--surface`, inactive are flat/ghost. Small monochrome Lucide icon + label.

**Bottom navigation** — **full-colour icons** (Rev 2 override of Rev 1's monochrome). Project/domain
emoji icons, as before. Active label/icon = accent; inactive = muted. Colour is intentional here for
fast recognition.

**App header (top bar)** — restored from the vanilla original: brand on the left (`/static/logo.png`
32px rounded + "KimFam Hub" bold + "KIM FAM Investment Club" muted), and on the right the
LanguageSwitcher, the **profile avatar** (`/static/avatars/<lowercased-alnum-name>.jpg`, circular,
green ring, falls back to the member's initial), and a **power-switch logout** (Lucide `Power` icon,
not a text button). Sits on `--surface`.

## Iconography

Two-tier (Rev 2): **Lucide line icons** for in-card *controls* (buttons, toggles, chevrons) — consistent
stroke, clean. **Full-colour emoji** for *identity & navigation*: project domain icons inside a circular
avatar tile (with a soft themed glow behind), and the bottom-nav destinations. Colour is reserved for
recognition/identity; controls stay line-style for calm.

## Modals & card contrast

Modals/bottom-sheets sit on the **dark canvas** (`--background` #121824), NOT on `--surface`, so
that `--card` (#1E293B) panels inside them visibly rise off the background. The palette is
low-contrast by design; cards only read as distinct when placed on the darkest layer. Same rule on
pages: cards go on the canvas, never on a near-same-shade surface.

## Project card decompression ("View Management Actions")

Project cards are kept roomy: a card shows identity (avatar + title + status + lead), the themed hero
metric, the latest update, then a single **full-width "View Management Actions" trigger** that
collapses Analysis / Audit / Show Details (+ Income) — instead of a cramped multi-column button row —
then the Team Interest accordion. Cards are "islands": `mb-5` (20px) gap, 16px radius, border + shadow,
on the canvas so the gap is a clear visual channel. (Halved from the original 40px on 2026-06-10 —
40px read as too loose once cards stood off the background properly.)

**Safe areas (notched devices):** `index.html` viewport is `viewport-fit=cover`; the top bar pads
`calc(8px + env(safe-area-inset-top))`, the bottom nav grows by and pads `env(safe-area-inset-bottom)`,
and `main` adds the same to its bottom padding so content never hides under the notch or home indicator.

## Analysis modal (executive dashboard, not a data dump)

Project `/detail` data renders as an **executive dashboard**, never a raw table: hero KPI card(s) for
the headline money figures at the very top; scalar objects as label-left / value-right KPI rows
(money values green); arrays/logs as **feed cards** (date bold + count badge + reason in a left-accent
callout), never `<table>`; long notes in callout boxes; subtle `white/5%` dividers.

## Amendment Log (the journey — for defence & recreation)

**Rev 1 (base spec):** depth-over-contrast slate theme; monochrome Lucide nav; status pills; accordion; uniform 8px outline buttons; +Interest demoted; +X media.

**Rev 2 (2026-06-10) — "Coherence Meets Color":** keep the structural cleanliness of Rev 1, re-introduce intentional colour that *aids navigation* rather than cluttering. Overrides parts of Rev 1:
- **Colourful icons restored.** Project domain emoji stay multicolour (chicken warm, car blue/red, mango gradient). **Bottom navigation reverts to full-colour icons** (was monochrome in Rev 1) — colour is wanted here.
- **Subtle colour glow behind the icon only** (not the card border) for depth — soft halo in the venture's theme colour.
- **Themed metric panels.** The hero metric (e.g. "60% Production Rate" bar) is colour-coded by venture **category**: Farming & Agriculture = green, Business Ventures (Washing Bay) = water blue, Unit Trusts = violet, Real Estate = amber. Aids subconscious categorisation. See `CATEGORY_THEME` in `ProjectsPage.tsx`.
- **Cleaner padding / breathable spacing.** Cards slightly taller; every element gets air; headers align (F-shape scan path); sub-details subtly indented. `Show Details` restored as the 3rd uniform button (Analysis / Audit / Details).
- Status pills, Team Interest accordion (collapsed default), and +X media standardisation from Rev 1 are **kept**.

What did NOT change: canvas `#121824` / card `#1E293B`, no neon borders, Inter type, low-saturation status pills, the accordion pattern, uniform 8px buttons, demoted Interest action.

**Rev 3 (2026-06-10) — Mobile sheet overlays & custom controls:** modals were desktop-style centred dialogs with raw native checkboxes ("Component Amnesia"). Fixed:
- **All modals are native bottom sheets on mobile** — slide up from the base, full width, rounded top corners (`22px`), a grab handle, `max-h 92vh`, safe-area padding. Desktop keeps the centred dialog. Implemented in `ui/dialog.tsx` via a viewport hook (not `md:`, which is unreliable here).
- **Express Interest modal:** YOUR ROLE is now a **full-width segmented pill control** (active = emerald gradient fill). CONTRIBUTION MODES use **custom square checkbox components** (no native browser checkboxes), generous spacing, lead-locked items dimmed.
- Standing rule going forward: **never ship a centred desktop dialog on mobile, and never use raw `<input type=checkbox>` visuals** — use the sheet + custom controls.

**Rev 4 (2026-06-10) — Motion layer (purposeful, not decorative):** animation is added only where it directs attention or conveys state. All of it respects `prefers-reduced-motion` (single guard in `index.css`).
- **Rotating rim highlight** on the Portfolio AI / New Ventures feature pills — a conic-gradient "highlight" travels around the border (`.glow-rim`, colour via `--rim`; uses `@property --rim-angle`). Reserved for the two special launchers, never on data cards.
- **Enticing CTA pulse** on `Express Interest` when the member has NOT yet applied (`.cta-entice`, soft green breathing glow + micro-scale) — pulls them to act. Once they apply, the button is **replaced by an approval-status control** (`MyInterestStatus`): `Checking approval…` (shimmer) → `Awaiting Chairman` → `Interest Confirmed` (shield-check). Rejected reverts to the enticing button so they can re-express.
- **Scroll-focus** on the project list: the card whose centre is nearest the viewport centre stays full; neighbours dim (to ~0.45) and shrink (to ~0.95). Driven per-frame via a single rAF scroll listener in `ProjectsPage` (no CSS transition — it would lag the scroll).
- **Count-up + reveal hero metrics**: the first numeric token of each headline (e.g. `60%`, `580K`) counts 0→target when the card scrolls into view; headlines with NO number get a fade/slide reveal instead so every highlight animates. `useInView` re-triggers (flips false on exit), so both **replay on every re-entry** (`AnimatedHeadline` + `useInView`).
- **Typewriter brand line**: the top-bar subtitle types through the club's mission lines, first phrase = "KIM FAM Investment Club" so it reads correctly on first paint (`Typewriter` in `AppShell`).
- **"All" pill** is now a real control: closes any open feature modal and smooth-scrolls the list to the top (was a dead `<span>`).
- **"Why join" bubble** (`JoinBubble` in `ProjectsPage`): when a card settles into focus (nearest viewport centre, after ~650ms) and the member has NOT expressed interest, a floating bubble pops over the card bottom with a pitch + "Not now" / "Express Interest". Dismiss is suppressed for the session (`sessionStorage`). Only the single focused card shows it, so it is never spammy. It chimes a soft synthesised "pop" on appear (`lib/sound.ts`, Web Audio, unlocked on first gesture — no asset shipped). The pitch text is **AI-cooked, figure-led** (`GET /api/projects/pitches`, from the `pitch_engine.py` always-cooking service, DeepSeek→Haiku→Gemini, cheap models only — see ADR-009); falls back to a static per-category line until cooked.
- **Ask KimFam attention magnet**: the bottom-tab 🤖 runs a periodic wiggle + constant blue/violet glow pulse (`.attention-ask`) so the eye keeps returning to it.
- **Spacing**: project cards `mb-3` (12px) island gap; filter-pill row to first card `mb-4` (16px). Tightened from the earlier 20/40px once the motion made the list feel busier.

**Rev 5 (2026-06-10) — In-app media + inline accounting:**
- **Media slider + lightbox.** Card media (`MediaCarousel`) is a horizontal in-card slider; tapping any tile opens a full-screen in-app carousel (swipeable, dots, prev/next, `index/total`). Videos use `playsInline` + `controls` so they play inline and never hijack to the OS player; closing returns to the app. The lightbox is **portaled to `<body>`** because the card carries a scroll-focus transform that would otherwise trap a `position:fixed` overlay. Replaces the old +X grid that did `window.open` (which left the app). Standing rule: **never open media in a new tab; keep the member in the app.**
- **Washing Bay capital accountability** (`WashingBayCapital`): an inline module under the washing_bay management actions showing a balancing progress bar (accounted vs the 25.9M CapEx target), the unaccounted amount, a per-contributor split, and a risk callout when not balanced. Contributor is a dropdown (Dad and Alex first, then the rest, then free text). PIN-gated writes. The Analysis modal also surfaces a "No capital accountability" risk while the CapEx is unproven. See ADR-010.

**Rev 6 (2026-06-10) — Constitution-aligned category filters:** the Projects header has a real filter row — **All / Farming / Business / Unit Trusts / Real Estate** (each with a live count), filtering the card list in place (`FILTERS` in `ProjectsPage`). "All" is the reset (it was previously a dead scroll-to-top button, now removed). The **Portfolio AI / New Ventures** AI launchers moved to their own row below the filters (no longer mixed with the filter). Each card also carries a small **constitution asset-class tag** (`ASSET_CLASS`): the club's Investment & Reward Guidelines define four asset classes — **Real estate, Unit trusts, Government securities, Alternative investments** — so most operating projects (farming, business) are tagged "Alternative investment", `fortune_credit` = Unit trust, `kakoba` = Real estate. (Guidelines are Draft 1, not yet ratified; Constitution Clause 5 Objectives is the ratified source.)

**Rev 7 (2026-06-11) — "Watch the AI think":** the AI Portfolio Analysis modal (Portfolio AI / New Ventures) now consumes the **SSE streaming** endpoints (`/api/portfolio/ranking/stream`, `/api/portfolio/new_ventures/stream`) instead of the blocking ones, and renders a live **`AiThinking`** panel: animated stepper (spinner on the active line, green check on completed), a progress bar, a running timer, and each stage fading in (`useSseJob` hook + `lib/sseJob.ts`). The backend emits **real interim findings** as steps (e.g. "Lead pick so far: 🍯 Apiary at 9/10") and **heartbeat "thinking" lines every ~7s during slow model calls** — which both keeps the SSE alive past nginx's idle timeout and makes the reasoning visible. Standing rule: long AI operations stream their progress; never a single static spinner for a multi-stage job.

## Anti-patterns (explicitly rejected)

- Loud neon/saturated borders; dark-on-dark over-saturation.
- Secondary text jammed against card edges (give vertical padding).
- Inconsistent button radii; an over-intense filled CTA absorbing the metric matrix.
- Raw status tokens like `awaiting_chairman` — always title-case ("Awaiting Chairman").
- Camera-crop images in compressed/uneven aspect ratios.
- Colour on *card borders* or as neon outlines (colour belongs on icons, glows, and themed metric
  panels only — never as a loud structural border).
- **NEVER add an unlayered global reset like `* { margin: 0; padding: 0 }` in `index.css`.** Tailwind
  v4 puts utilities in a cascade *layer*; an unlayered universal rule beats every `mb-*`/`p-*`/`space-*`
  utility regardless of specificity, silently zeroing ALL margins and padding app-wide. This caused
  hours of "cards don't separate / content is cramped" debugging. Tailwind Preflight already resets
  correctly inside its layer. Keep only `box-sizing: border-box` if anything.
