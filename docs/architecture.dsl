workspace {
    model {
        hillary = person "Hillary Arinda" "KimFam member and system administrator"
        member  = person "KimFam Member"  "Family investment club member"

        kimfam = softwareSystem "KimFam Hub" "Family investment club portal" {
            webapp = container "FastAPI Web App" "PWA served via Gunicorn/Uvicorn. Handles auth, API, SSE, and HTML." "Python / FastAPI" {
                authApi     = component "Auth API"          "/api/login, /api/verify-otp, /api/me"
                askApi      = component "Ask KimFam API"    "/api/ask/stream — SSE endpoint, RAG pipeline"
                financeApi  = component "Finance API"       "Contributions, loans, projects, balances"
                adminApi    = component "Admin API"         "Member management, config, documents"
                scheduler   = component "APScheduler"       "Meeting reminders, notification jobs"
                askAgent    = component "Ask Agent"         "manager_node → tool chain → synthesizer_node"
                chromadb    = component "ChromaDB"          "Local vector store for RAG over governance docs"
            }
            nginx = container "Nginx" "Reverse proxy, SSL termination, static files" "Nginx"
            db    = container "SQLite / Data Layer" "kimfam.db: members, meetings, loans, payments" "SQLite"
        }

        googleSheets = softwareSystem "Google Sheets" "Source of truth for financial ledger" "External"
        whatsapp     = softwareSystem "WhatsApp" "Notification delivery for OTPs and meeting reminders" "External"
        cloudflare   = softwareSystem "Cloudflare R2" "Object storage for PDFs, minutes, media (10GB free tier)" "External"
        anthropic    = softwareSystem "Anthropic API" "Claude Sonnet 4.x — Ask KimFam AI backbone" "External"
        gemini       = softwareSystem "Gemini API" "Gemini 2.5 Flash — fallback AI" "External"
        groq         = softwareSystem "Groq API" "llama-3.3-70b — final fallback AI" "External"
        hetzner      = softwareSystem "Hetzner VPS" "89.167.121.193 — production host" "External"

        member  -> nginx     "HTTPS"
        hillary -> nginx     "HTTPS / SSH"
        nginx   -> webapp    "Proxy"
        webapp  -> db        "SQL reads/writes"
        webapp  -> googleSheets "Sheets API v4 — financial data"
        webapp  -> whatsapp  "WhatsApp MCP / direct API"
        webapp  -> cloudflare "S3-compatible SDK — docs and media"
        askAgent -> anthropic "Claude Sonnet 4.x"
        askAgent -> gemini    "Fallback"
        askAgent -> groq      "Final fallback"
        askAgent -> chromadb  "Embedding search"
        webapp  -> hetzner    "Deployed on"
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
        theme default
    }
}
