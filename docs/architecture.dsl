workspace {
    model {
        hillary = person "Hillary Arinda" "KimFam member, developer and system administrator"
        member  = person "KimFam Member"  "Family investment club member"

        kimfam = softwareSystem "KimFam Hub" "Family investment club portal" {
            frontend = container "React SPA" "Vite + React 19 + TS + Tailwind v4. Renders all screens; mobile bottom-sheet modals; design system per docs/design-system.md." "TypeScript / React" {
                designSystem = component "Design System"   "ui/ primitives (Button, Card, Dialog/sheet, Tabs, Badge) + tokens in index.css. shadcn/Radix style."
                projectsUI   = component "Projects UI"      "Cards, Audit/Analysis/Portfolio/Viability-Matrix modals, Team Interest accordion, Express Interest sheet"
                proposalsUI  = component "Proposals UI"      "Submit + AI scorecard (criteria bars, support-readiness), versioned per project owner"
                i18n         = component "i18n"             "react-i18next — en / sw / rny"
                query        = component "Data Layer"       "TanStack Query against the FastAPI JSON API"
            }
            webapp = container "FastAPI Web App" "Gunicorn/Uvicorn. Auth, JSON API, SSE, serves the built SPA." "Python / FastAPI" {
                authApi     = component "Auth API"          "/api/auth/* — login, WhatsApp OTP reset, JWT cookie"
                askApi      = component "Ask KimFam API"    "/api/ask/stream — SSE RAG pipeline"
                financeApi  = component "Finance API"       "Contributions, loans, equity, projects, balances"
                projectApi  = component "Projects API"       "/api/projects/* — detail, audit, narrative, interests, projection (viability matrix); /api/portfolio/* ranking + new ventures"
                investmentEngine = component "Investment Projection Engine" "investment.py — pure, unit-tested month-by-month viability matrix (own vs borrowed capital, member-lender payout, mandatory downside). See ADR-024"
                adminApi    = component "Admin API"         "Member management, config, documents"
                docsApi     = component "Documents API"      "/api/docs — nested category/sub-group repo over R2; serve/preview docx/pdf/pptx/xlsx"
                proposalsApi = component "Proposals API"     "/api/proposals — upload, Claude-only AI scoring vs the Project Proposal Template + reward guidelines, support-readiness, versioning/archiving"
                meetingsApi = component "Meetings API"       "/api/meetings/* — conductor full-call recording, diarized transcription, minutes narrative (Sonnet map-reduce) + docx, publish"
                scheduler   = component "APScheduler"       "Meeting reminders, notification jobs (fcntl lock)"
                chromadb    = component "ChromaDB"          "Local vector store for RAG over governance docs"
            }
            nginx = container "Nginx" "Reverse proxy, SSL, serves SPA index + /assets" "Nginx"
            pg    = container "PostgreSQL" "kimfamhub (prod) / kimfamhub_test (staging): members, families, contributions, loans, project_participation" "PostgreSQL"
            sqlite= container "SQLite stores" "auth (kimfam.db), washing_bay.db income" "SQLite"
        }

        ci          = softwareSystem "GitHub Actions" "CI/CD: push to any branch deploys staging; main promotes to prod after green tests + Claude self-heal" "External"
        designLoop  = softwareSystem "Design Review Loop" "tools/design-loop: Playwright screenshots staging, Gemini critiques vs design-system.md" "External"
        kimfamSheet  = softwareSystem "KimFam Financials Sheet" "Meeting Register, Action Tracker, financial ledger — managed by Hillary/Hellen on the main KimFam Google Sheet" "External"
        solomonSheet = softwareSystem "Solomon's AppSheet" "Chicken project P&L — Solomon's operational records (flock counts, expenses, revenue) entered via AppSheet mobile app, stored in a separate Google Sheet owned by Solomon" "External"
        whatsapp    = softwareSystem "WhatsApp" "OTPs, meeting reminders, group auto-capture" "External"
        cloudflare  = softwareSystem "Cloudflare R2" "Object storage for PDFs, minutes, media" "External"
        claudeCli   = softwareSystem "Claude CLI" "claude -p subprocess on Hetzner (Max subscription, no API key) — Ask/audit/narrative primary" "External"
        gemini      = softwareSystem "Gemini API" "Gemini 2.5 Flash — AI fallback + design-loop critic (nano banana needs paid tier)" "External"
        groq        = softwareSystem "Groq API" "llama-3.3-70b — final AI fallback; Whisper transcription fallback" "External"
        deepgram    = softwareSystem "Deepgram API" "nova-3 speech-to-text with speaker diarization — primary meeting-recording transcription (ADR-022)" "External"
        hetzner     = softwareSystem "Hetzner VPS" "89.167.121.193 — prod + staging hosts" "External"

        member   -> nginx     "HTTPS"
        hillary  -> nginx     "HTTPS / SSH"
        nginx    -> frontend  "Serves SPA"
        nginx    -> webapp    "Proxies /api"
        frontend -> webapp    "JSON / SSE over /api"
        webapp   -> pg        "SQL reads/writes (role: kimfam)"
        webapp   -> sqlite    "Auth + washing bay"
        webapp   -> kimfamSheet  "Sheets API v4 — meetings, actions, ledger"
        webapp   -> solomonSheet "Sheets API v4 — chicken data read-only"
        webapp   -> whatsapp  "WhatsApp bridge"
        webapp   -> cloudflare "S3-compatible SDK"
        askApi   -> claudeCli "Primary"
        askApi   -> gemini    "Fallback"
        askApi   -> groq      "Final fallback"
        askApi   -> chromadb  "Embedding search (local sentence-transformers)"
        projectApi -> claudeCli "Audit/narrative/portfolio AI"
        projectApi -> investmentEngine "Computes viability matrix (pure function)"
        projectApi -> financeApi "Reads confirmed bank balance (get_summary) for the projection"
        proposalsApi -> claudeCli "Proposal scoring (Claude only; framework docs as context; SSE progress)"
        proposalsApi -> cloudflare "Stores proposal files (projects/Proposals/<title>/v<n>)"
        proposalsApi -> pg "proposals table (scores, versions, readiness, file_hash, uploaded_at)"
        proposalsApi -> whatsapp "Owner confirmation on submit; deliberate group share (ready for review)"
        meetingsApi -> deepgram "Diarized transcription of the full-call recording (nova-3)"
        meetingsApi -> groq "Whisper transcription fallback"
        meetingsApi -> claudeCli "Minutes narrative (Sonnet map-reduce) + edits"
        meetingsApi -> cloudflare "Publishes minutes docx (7-day link)"
        meetingsApi -> whatsapp "Meeting reminders + minutes links"
        financeApi -> pg "Contributions, per-month arrears detail, receipts (ADR-023)"
        docsApi  -> cloudflare "Lists/serves the document repo"
        ci       -> hetzner   "rsync + systemctl restart (staging, then prod on main)"
        ci       -> claudeCli "Self-heal step on test failure"
        designLoop -> frontend "Screenshots staging"
        designLoop -> gemini  "Critique vs spec"
        webapp   -> hetzner   "Deployed on"
        frontend -> hetzner   "Built dist deployed on"
    }

    views {
        systemContext kimfam "SystemContext" {
            include *
            autoLayout
        }
        container kimfam "Containers" {
            include *
            autoLayout
        }
        component frontend "FrontendComponents" {
            include *
            autoLayout
        }
        theme default
    }
}
