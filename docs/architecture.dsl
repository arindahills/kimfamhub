workspace {
    model {
        hillary = person "Hillary Arinda" "KimFam member, developer and system administrator"
        member  = person "KimFam Member"  "Family investment club member"

        kimfam = softwareSystem "KimFam Hub" "Family investment club portal" {
            frontend = container "React SPA" "Vite + React 19 + TS + Tailwind v4. Renders all screens; mobile bottom-sheet modals; design system per docs/design-system.md." "TypeScript / React" {
                designSystem = component "Design System"   "ui/ primitives (Button, Card, Dialog/sheet, Tabs, Badge) + tokens in index.css. shadcn/Radix style."
                projectsUI   = component "Projects UI"      "Cards, Audit/Analysis/Portfolio modals, Team Interest accordion, Express Interest sheet"
                i18n         = component "i18n"             "react-i18next — en / sw / rny"
                query        = component "Data Layer"       "TanStack Query against the FastAPI JSON API"
            }
            webapp = container "FastAPI Web App" "Gunicorn/Uvicorn. Auth, JSON API, SSE, serves the built SPA." "Python / FastAPI" {
                authApi     = component "Auth API"          "/api/auth/* — login, WhatsApp OTP reset, JWT cookie"
                askApi      = component "Ask KimFam API"    "/api/ask/stream — SSE RAG pipeline"
                financeApi  = component "Finance API"       "Contributions, loans, equity, projects, balances"
                projectApi  = component "Projects API"       "/api/projects/* — detail, audit, narrative, interests; /api/portfolio/* ranking + new ventures"
                adminApi    = component "Admin API"         "Member management, config, documents"
                scheduler   = component "APScheduler"       "Meeting reminders, notification jobs (fcntl lock)"
                chromadb    = component "ChromaDB"          "Local vector store for RAG over governance docs"
            }
            nginx = container "Nginx" "Reverse proxy, SSL, serves SPA index + /assets" "Nginx"
            pg    = container "PostgreSQL" "kimfamhub (prod) / kimfamhub_test (staging): members, families, contributions, loans, project_participation" "PostgreSQL"
            sqlite= container "SQLite stores" "auth (kimfam.db), washing_bay.db income" "SQLite"
        }

        ci          = softwareSystem "GitHub Actions" "CI/CD: push to any branch deploys staging; main promotes to prod after green tests + Claude self-heal" "External"
        designLoop  = softwareSystem "Design Review Loop" "tools/design-loop: Playwright screenshots staging, Gemini critiques vs design-system.md" "External"
        googleSheets= softwareSystem "Google Sheets" "Live chicken P&L + financial ledger source" "External"
        whatsapp    = softwareSystem "WhatsApp" "OTPs, meeting reminders, group auto-capture" "External"
        cloudflare  = softwareSystem "Cloudflare R2" "Object storage for PDFs, minutes, media" "External"
        claudeCli   = softwareSystem "Claude CLI" "claude -p subprocess on Hetzner (Max subscription, no API key) — Ask/audit/narrative primary" "External"
        gemini      = softwareSystem "Gemini API" "Gemini 2.5 Flash — AI fallback + design-loop critic (nano banana needs paid tier)" "External"
        groq        = softwareSystem "Groq API" "llama-3.3-70b — final AI fallback" "External"
        hetzner     = softwareSystem "Hetzner VPS" "89.167.121.193 — prod + staging hosts" "External"

        member   -> nginx     "HTTPS"
        hillary  -> nginx     "HTTPS / SSH"
        nginx    -> frontend  "Serves SPA"
        nginx    -> webapp    "Proxies /api"
        frontend -> webapp    "JSON / SSE over /api"
        webapp   -> pg        "SQL reads/writes (role: kimfam)"
        webapp   -> sqlite    "Auth + washing bay"
        webapp   -> googleSheets "Sheets API v4"
        webapp   -> whatsapp  "WhatsApp bridge"
        webapp   -> cloudflare "S3-compatible SDK"
        askApi   -> claudeCli "Primary"
        askApi   -> gemini    "Fallback"
        askApi   -> groq      "Final fallback"
        askApi   -> chromadb  "Embedding search (local sentence-transformers)"
        projectApi -> claudeCli "Audit/narrative/portfolio AI"
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
