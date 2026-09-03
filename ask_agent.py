"""
KimFam Ask — Agentic RAG (AskImmigrate 2.0 pattern)
Manager node routes to Sheet tool or RAG tool (or both).
Synthesizer node builds the final answer.
Session memory: SQLite conversation history.
"""

import os
import json
import sqlite3
import hashlib
import logging
import re
from datetime import datetime
from functools import lru_cache
from typing import TypedDict, Any

import chromadb
# from openai import OpenAI  # removed: switched to Gemini + Groq

log = logging.getLogger("ask_agent")

# ── Constants ──────────────────────────────────────────────────────────────────
BASE_DIR = "/var/www/kimfamhub"
CHROMA_DIR = os.path.join(BASE_DIR, "data", "chroma")
SESSIONS_DB = os.path.join(BASE_DIR, "data", "sessions.db")
COLLECTION_NAME = "kimfam_docs"
RAG_TOP_K = 5
RAG_THRESHOLD = 0.3
EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"  # local, 384-dim, no API
TOOL_CACHE_TTL = 3600  # seconds

MEDIA_CATALOG = """
AVAILABLE MEDIA (use exact URLs when relevant to the answer):

DAIRY PROJECT:
- Photo: /static/project-pics/dairy/dairy_img_1.jpg  (exterior shed structure)
- Photo: /static/project-pics/dairy/dairy_img_2.jpg  (feed trough)
- Photo: /static/project-pics/dairy/dairy_img_3.jpg  (herd under roof)
- Photo: /static/project-pics/dairy/dairy_img_4.jpg  (empty shed interior)
- Photo: /static/project-pics/dairy/dairy_img_5.jpg  (cow close-up)
- Video: /static/project-pics/dairy/dairy_vid_herd.mp4  (herd footage)
- Video: /static/project-pics/dairy/dairy_vid_stalls.mp4  (stall area)
- Video: /static/project-pics/dairy/dairy_vid_exterior.mp4  (shed exterior)
- Video: /static/project-pics/dairy/dairy_vid_feeding.mp4  (feeding time)

SHEEP PROJECT:
- Photo: /static/project-pics/sheep/WhatsApp%20Image%202026-05-19%20at%2020.53.29.jpeg  (tagged sheep 1)
- Photo: /static/project-pics/sheep/WhatsApp%20Image%202026-05-19%20at%2020.54.45.jpeg  (tagged sheep 2)
- Photo: /static/project-pics/sheep/WhatsApp%20Image%202026-05-19%20at%2020.55.09.jpeg  (tagged sheep 3)

WASHING BAY PROJECT:
- Video: /static/project-pics/washing-bay/washing_bay_vision.mp4  (vision reference)

To include a photo in your answer: ![description](URL)
To include a video in your answer: [video: description](URL)
CRITICAL: No spaces inside the parentheses. Wrong: ]( /url ) Correct: ](/url)
Only include media when it genuinely adds value (e.g. member asks to see the dairy shed).
Include 1-2 items maximum — do not dump all media at once.
"""

# ── State ──────────────────────────────────────────────────────────────────────
class KimFamState(TypedDict):
    question: str
    session_id: str
    conversation_history: list[dict]
    is_followup: bool
    manager_routing: dict          # {"tools": [...], "family": str|None, "use_rag": bool, "doc_type_filter": str|None}
    sheet_result: str
    rag_result: str
    tool_result: str               # structured live data from data tools
    answer: str


# ── Database ───────────────────────────────────────────────────────────────────
def _db():
    os.makedirs(os.path.dirname(SESSIONS_DB), exist_ok=True)
    conn = sqlite3.connect(SESSIONS_DB)
    conn.execute("""CREATE TABLE IF NOT EXISTS conversation_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_number INTEGER NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        context_json TEXT DEFAULT '{}',
        updated_at TEXT DEFAULT (datetime('now'))
    )""")
    conn.commit()
    return conn


def load_history(session_id: str, last_n: int = 6) -> list[dict]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT question, answer FROM conversation_turns "
            "WHERE session_id=? ORDER BY turn_number DESC LIMIT ?",
            (session_id, last_n)
        ).fetchall()
    return [{"q": r[0], "a": r[1]} for r in reversed(rows)]


def save_turn(session_id: str, question: str, answer: str):
    with _db() as conn:
        turn_num = (conn.execute(
            "SELECT COUNT(*) FROM conversation_turns WHERE session_id=?",
            (session_id,)
        ).fetchone()[0] or 0) + 1
        conn.execute(
            "INSERT INTO conversation_turns (session_id, turn_number, question, answer) VALUES (?,?,?,?)",
            (session_id, turn_num, question, answer)
        )
        conn.commit()


# ── Tool result cache ──────────────────────────────────────────────────────────
_tool_cache: dict[str, tuple[str, float]] = {}

def _cache_key(*args) -> str:
    return hashlib.md5("|".join(str(a) for a in args).encode()).hexdigest()

def _cache_get(key: str) -> str | None:
    import time
    if key in _tool_cache:
        val, ts = _tool_cache[key]
        if time.time() - ts < TOOL_CACHE_TTL:
            return val
        del _tool_cache[key]
    return None

def _cache_set(key: str, val: str):
    import time
    if len(_tool_cache) > 100:
        oldest = min(_tool_cache, key=lambda k: _tool_cache[k][1])
        del _tool_cache[oldest]
    _tool_cache[key] = (val, time.time())


# ── ChromaDB client (singleton) ────────────────────────────────────────────────
_chroma_client = None
_chroma_collection = None

def _get_collection():
    global _chroma_client, _chroma_collection
    if _chroma_collection is None:
        _chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
        _chroma_collection = _chroma_client.get_or_create_collection(COLLECTION_NAME)
    return _chroma_collection


# ── Gemini + Groq clients (singletons) ────────────────────────────────────────
_gemini_client = None
_groq_client = None

def _gemini():
    global _gemini_client
    if _gemini_client is None:
        from google import genai as genai_client
        _gemini_client = genai_client.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
    return _gemini_client

def _groq():
    global _groq_client
    if _groq_client is None:
        from groq import Groq
        _groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY", ""))
    return _groq_client

def _chat(prompt: str, max_tokens: int = 1024) -> str:
    """Generate completion: Claude Sonnet → Gemini Flash → Groq llama-3.3-70b."""
    import subprocess, time
    last_err = None

    # Claude primary (Claude Code CLI, authenticated on this server)
    try:
        env = dict(os.environ); env["HOME"] = "/root"
        r = subprocess.run(
            ["claude", "-p", prompt[:100000], "--model", "sonnet"],
            capture_output=True, text=True, timeout=90, env=env
        )
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
        last_err = r.stderr[:200] if r.stderr else "claude returned empty"
    except Exception as e:
        last_err = e

    # Gemini fallback
    import time as _time
    try:
        gc = _gemini()
        for model in ["gemini-2.5-flash", "gemini-2.5-flash-lite"]:
            try:
                resp = gc.models.generate_content(model=model, contents=prompt)
                txt = (resp.text or "").strip()
                if txt:
                    log.info("Ask KimFam: fell back to Gemini")
                    return txt
            except Exception as e:
                last_err = e
                _time.sleep(0.5)
    except Exception as e:
        last_err = e

    # Groq final fallback
    try:
        completion = _groq().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt[:120000]}],
            max_tokens=max_tokens,
        )
        log.info("Ask KimFam: fell back to Groq")
        return (completion.choices[0].message.content or "").strip()
    except Exception as e:
        last_err = e

    log.error(f"All chat providers failed; last: {last_err}")
    raise RuntimeError(f"All chat providers failed: {last_err}")


# ── RAG tool ───────────────────────────────────────────────────────────────────
_st_model = None
def _st():
    global _st_model
    if _st_model is None:
        from sentence_transformers import SentenceTransformer
        log.info(f"Loading local embedder: {EMBED_MODEL}")
        _st_model = SentenceTransformer(EMBED_MODEL)
    return _st_model

@lru_cache(maxsize=200)
def _embed_query(text: str) -> tuple:
    vec = _st().encode(text, normalize_embeddings=True)
    return tuple(float(x) for x in vec)


def rag_tool(question: str, doc_type_filter: str | None = None) -> str:
    cache_key = _cache_key("rag", question, doc_type_filter or "")
    cached = _cache_get(cache_key)
    if cached:
        return cached

    collection = _get_collection()
    embedding = list(_embed_query(question))

    where = {"doc_type": doc_type_filter} if doc_type_filter else None
    try:
        results = collection.query(
            query_embeddings=[embedding],
            n_results=RAG_TOP_K,
            where=where,
            include=["documents", "metadatas", "distances"],
        )
    except Exception as e:
        log.warning(f"ChromaDB query error: {e}")
        return ""

    docs = results.get("documents", [[]])[0]
    metas = results.get("metadatas", [[]])[0]
    dists = results.get("distances", [[]])[0]

    chunks = []
    for doc, meta, dist in zip(docs, metas, dists):
        similarity = 1 - dist
        if similarity < RAG_THRESHOLD:
            continue
        source = meta.get("source", "document")
        chunks.append(f"[{source}]\n{doc}")

    result = "\n\n---\n\n".join(chunks) if chunks else ""
    _cache_set(cache_key, result)
    return result


# ── Data tools (live app endpoints) ────────────────────────────────────────────
# These call the same PostgreSQL-backed functions the app's Finances tab uses, so
# the AI answers from live structured data — not stale RAG or a sheet snapshot.
import contributions as _contrib

def _ugx(n):
    try:
        return "UGX " + format(int(round(n)), ",")
    except Exception:
        return str(n)

def _member_family_name(member_name: str):
    """Reverse-lookup the family a member belongs to via PostgreSQL."""
    if not member_name:
        return None
    try:
        import sys, os
        sys.path.insert(0, "/var/www/kimfamhub")
        import family_db
        return family_db.member_family(member_name)
    except Exception:
        return None

def _fmt_family(row) -> str:
    name = row["family_name"].capitalize()
    cur = row.get("current_balance", 0) or 0
    init = row.get("initial_balance", 0) or 0
    rate = row.get("current_monthly_rate", 0) or 0
    combined = row.get("combined_balance", 0) or 0
    parts = [f"{name} (monthly rate {_ugx(rate)}):"]
    # Monthly position
    if cur < 0:
        ahead = int(abs(cur) / rate) if rate else 0
        parts.append(f"  Monthly: {_ugx(abs(cur))} in CREDIT (paid ahead ~{ahead} month(s))")
    elif cur == 0:
        parts.append("  Monthly: up to date")
    else:
        parts.append(f"  Monthly arrears owed: {_ugx(cur)}")
    # Opening balance
    if init > 0:
        parts.append(f"  Opening balance still owed: {_ugx(init)}")
    else:
        parts.append("  Opening balance: cleared")
    # Net outstanding (credit doesn't offset opening)
    outstanding = init if cur <= 0 else combined
    if outstanding <= 0:
        parts.append("  TOTAL OUTSTANDING: nothing owed")
    else:
        parts.append(f"  TOTAL OUTSTANDING: {_ugx(outstanding)}")
    return "\n".join(parts)

def tool_my_family(member_name: str) -> str:
    fam = _member_family_name(member_name)
    if not fam:
        return ("MY FAMILY: Could not determine which family this member belongs to. "
                "Ask them to confirm their family name, or they can check the Finances tab.")
    led = _contrib.get_ledger()
    row = next((r for r in led if r["family_name"].upper() == fam.upper()), None)
    if not row:
        return f"MY FAMILY ({fam}): no balance record found."
    return "MY FAMILY BALANCE (asking member is in " + fam.capitalize() + "):\n" + _fmt_family(row)

def tool_family(family_name: str) -> str:
    if not family_name:
        return ""
    led = _contrib.get_ledger()
    row = next((r for r in led if r["family_name"].upper() == family_name.upper()), None)
    if not row:
        avail = ", ".join(r["family_name"].capitalize() for r in led)
        return f"FAMILY '{family_name}' not found. Known families: {avail}."
    return "FAMILY BALANCE:\n" + _fmt_family(row)

def tool_all_families() -> str:
    led = _contrib.get_ledger()
    return "ALL FAMILY BALANCES:\n" + "\n".join(_fmt_family(r) for r in led)

def tool_club_summary() -> str:
    s = _contrib.get_summary()
    computed = s.get("computed_balance", 0)
    confirmed = s.get("confirmed_bank_balance", 0)
    gap = confirmed - computed
    lines = [
        "CLUB FINANCIAL SUMMARY (live):",
        f"  Opening balance (Jan 2023): {_ugx(s.get('opening_balance',0))}",
        f"  Total contributions collected: {_ugx(s.get('total_contributions_paid',0))}",
        f"  Total expenditure recorded: {_ugx(s.get('total_expenditure',0))}",
        f"  Expected balance (opening + contributions - expenditure): {_ugx(computed)}",
        f"  Confirmed bank balance (ABSA, Hellen-verified {s.get('confirmed_balance_date','')}): {_ugx(confirmed)}",
        f"  Reconciliation gap (confirmed - expected): {_ugx(gap)}",
        f"  Total outstanding obligations across families: {_ugx(s.get('current_obligations',0))}",
    ]
    if abs(gap) > 10000:
        lines.append("  NOTE: books and bank are out of sync. The gap nets two things: "
                     "unrecorded expenses and unconfirmed member payments. Check both.")
    return "\n".join(lines)

def tool_expenditure(year: str | None = None, category: str | None = None) -> str:
    rows = _contrib.get_expenditure()
    if year:
        rows = [r for r in rows if str(r.get("txn_date", "")).startswith(str(year))]
    if category:
        rows = [r for r in rows if (r.get("category") or "").lower() == category.lower()]
    rows = rows[:25]
    if not rows:
        return "EXPENDITURE: no records match."
    total = sum(r.get("amount_ugx", 0) for r in rows)
    lines = [f"EXPENDITURE RECORDS (showing {len(rows)}, total {_ugx(total)}):"]
    for r in rows:
        proj = f" [{r['project']}]" if r.get("project") else ""
        lines.append(f"  {r.get('txn_date','')}: {r.get('description','')} — {_ugx(r.get('amount_ugx',0))} ({r.get('category','')}){proj}")
    return "\n".join(lines)

def tool_my_payments(member_name: str) -> str:
    if not member_name:
        return ""
    try:
        rows = _contrib.query(
            """SELECT cp.amount_ugx, cp.period_month, cp.status, cp.submitted_at, f.family_name
               FROM contribution_payments cp JOIN families f ON cp.family_id = f.id
               WHERE cp.submitted_by_user_id = %s
               ORDER BY cp.submitted_at DESC LIMIT 12""",
            (member_name,))
    except Exception as e:
        return f"MY PAYMENTS: lookup failed ({e})."
    if not rows:
        return f"MY PAYMENTS: no submissions found for {member_name}."
    lines = [f"PAYMENT HISTORY for {member_name}:"]
    for r in rows:
        when = str(r.get("submitted_at", ""))[:10]
        lines.append(f"  {when}: {_ugx(r.get('amount_ugx',0))} for {r.get('family_name','')} "
                     f"({r.get('period_month','')}) — {r.get('status','')}")
    return "\n".join(lines)


# ── Project analysis tools (live API data) ────────────────────────────────────
def _fetch_project_json(project_id: str, path: str = "detail") -> dict:
    import urllib.request as _ur, json as _j
    _key = os.environ.get("KIMFAM_INTERNAL_KEY", "")
    url = f"http://127.0.0.1:8000/api/projects/{project_id}/{path}"
    try:
        req = _ur.Request(url, headers={"X-Internal-Key": _key})
        with _ur.urlopen(req, timeout=10) as resp:
            return _j.loads(resp.read())
    except Exception as e:
        log.warning(f"_fetch_project_json {project_id}/{path}: {e}")
        return {}

_PROJECT_IDS = ["trees", "sheep", "washing_bay", "irrigation", "dairy", "bees", "chicken"]
_PROJECT_NAMES = {
    "trees": "Tree Planting", "sheep": "Sheep", "washing_bay": "Washing Bay",
    "irrigation": "Irrigation/Bananas", "dairy": "Dairy", "bees": "Beekeeping", "chicken": "Chicken",
}

def tool_project_analysis(project_id: str) -> str:
    """Live financial metrics for a specific project."""
    data = _fetch_project_json(project_id, "detail")
    if not data:
        return f"PROJECT {project_id}: live data unavailable."
    name = _PROJECT_NAMES.get(project_id, project_id.replace("_", " ").title())
    lines = [f"PROJECT ANALYSIS - {name} (live from app):"]
    # JUSTIFICATION-A3: net-new formatter branch for the live sheep-tracker response shape; not a wrap.
    # New live-tracker shape (sheep): summary/flock/mortality/financials/expense_breakdown/alerts.
    # The old formatter below reads overview/financial_metrics which this shape lacks, so handle it here.
    if data.get("summary") and (data.get("mortality") or data.get("flock")):
        for k, v in (data.get("summary") or {}).items():
            if not isinstance(v, (dict, list)):
                lines.append(f"  {k}: {v}")
        mort = data.get("mortality", {})
        if isinstance(mort, dict) and mort.get("by_cause"):
            lines.append(f"  deaths by cause: {mort.get('by_cause')}")
        eb = data.get("expense_breakdown", {})
        if eb:
            lines.append(f"  expenses by category: {eb}")
        pend = data.get("pending_pipeline", {})
        if isinstance(pend, dict) and pend.get("amount_ugx"):
            lines.append(f"  pending: {pend.get('item')} ({pend.get('amount_ugx')} UGX, {pend.get('status')})")
        alerts = data.get("alerts", [])
        if alerts:
            lines.append("  alerts: " + "; ".join(a.get("text", "") for a in alerts))
        return "\n".join(lines)
    ov = data.get("overview", {})
    if isinstance(ov, dict):
        for k, v in ov.items():
            if not isinstance(v, (dict, list)):
                lines.append(f"  {k}: {v}")
    inv = data.get("investment", {})
    if isinstance(inv, dict):
        for k, v in inv.items():
            if not isinstance(v, (dict, list)):
                lines.append(f"  investment.{k}: {v}")
    fm = data.get("financial_metrics", {})
    if fm:
        lines.append("  --- Financial Metrics ---")
        for k, v in fm.items():
            lines.append(f"  {k}: {v}")
    risks = data.get("risks", [])
    if risks:
        top = [r.get("title", "") for r in risks[:3] if r.get("title")]
        lines.append(f"  Key risks: {'; '.join(top)}")
    return "\n".join(lines)

def tool_portfolio_overview() -> str:
    """Live snapshot of all projects for comparison/ranking questions."""
    lines = ["PORTFOLIO OVERVIEW (live - all projects):"]
    for pid in _PROJECT_IDS:
        data = _fetch_project_json(pid, "detail")
        if not data:
            lines.append(f"  {_PROJECT_NAMES.get(pid, pid)}: unavailable")
            continue
        name = _PROJECT_NAMES.get(pid, pid)
        fm = data.get("financial_metrics", {})
        parts = [f"{k}={v}" for k, v in list(fm.items())[:4]]
        lines.append(f"  {name}: {', '.join(parts) if parts else '-'}")
    return "\n".join(lines)

def tool_equity_models(member_name: str | None = None) -> str:
    """Neutral per-family comparison of the three equity allocation models (A/B/C).
    Used so the AI can answer 'which model is best for my family' with REAL numbers,
    while staying neutral and NOT telling anyone how to vote."""
    # Call the equity computation directly (lazy import avoids a circular import at
    # module load, and dodges the internal-key / port fragility of an HTTP round-trip
    # to ourselves — works identically on staging :8001 and prod :8000).
    try:
        import main as _main
        data = _main._fetch_family_equity()
    except Exception as e:
        log.warning(f"tool_equity_models: {e}")
        return "EQUITY MODELS: live data unavailable."

    fams = data.get("family_summary", [])
    if not fams:
        return "EQUITY MODELS: no family data."

    my_family = None
    if member_name:
        from family_db import member_family as _mf
        try:
            my_family = (_mf(member_name) or "").title() or None
        except Exception:
            my_family = None

    lines = [
        "EQUITY MODELS — neutral per-family comparison (live). The three models are three ways to "
        "split ALL club expenses; a family's stake % = its claim on future profits.",
        "  Model A = Equal Share (protects low-balance families).",
        "  Model B = Proportional (tracks who actually funded what).",
        "  Model C = Solomon's (fixed weight by family size/obligation).",
        f"  Totals — A: {_ugx(data.get('total_eq_A',0))}, B: {_ugx(data.get('total_eq_B',0))}, C: {_ugx(data.get('total_eq_C',0))}.",
        "  PER FAMILY (equity UGX and % stake under each model):",
    ]
    for f in fams:
        tag = "  >> YOUR FAMILY << " if my_family and f.get("family") == my_family else "  "
        lines.append(
            f"{tag}{f.get('family')}: "
            f"A={_ugx(f.get('equity_A',0))} ({f.get('equity_A_pct',0)}%), "
            f"B={_ugx(f.get('equity_B',0))} ({f.get('equity_B_pct',0)}%), "
            f"C={_ugx(f.get('equity_C',0))} ({f.get('equity_C_pct',0)}%)"
        )
    lines.append(
        "  GUIDANCE RULE: explain the tradeoffs and show the family's own numbers, but DO NOT tell them "
        "which model to vote for — the choice is theirs. Note that if every family just picks whatever "
        "maximizes its own stake the vote can deadlock; the decision is meant to be a family consensus."
    )
    return "\n".join(lines)

def tool_project_audit_summary(project_id: str) -> str:
    """Assumptions and formula derivations for auditability questions."""
    data = _fetch_project_json(project_id, "audit")
    if not data:
        return f"AUDIT {project_id}: data unavailable."
    name = data.get("project", project_id)
    lines = [f"AUDIT DATA - {name}:", f"  Status: {data.get('status', 'unknown')}"]
    for a in data.get("assumptions", [])[:8]:
        lines.append(
            f"  ASSUMPTION: {a.get('variable')} = {a.get('value')} {a.get('unit','')} "
            f"[{a.get('type','')} / {a.get('confidence','')}] source: {a.get('source','')}"
        )
    for fd in data.get("formula_derivations", [])[:5]:
        lines.append(f"  FORMULA: {fd.get('metric')} = {fd.get('formula')} -> {fd.get('result')}")
    gaps = data.get("data_gaps", [])
    if gaps:
        lines.append(f"  Data gaps: {'; '.join(g.get('gap','') for g in gaps[:3])}")
    return "\n".join(lines)

_DATA_TOOLS = {
    "my_family": tool_my_family,
    "all_families": tool_all_families,
    "club_summary": tool_club_summary,
    "expenditure": tool_expenditure,
    "my_payments": tool_my_payments,
    "project_analysis": tool_project_analysis,
    "portfolio_overview": tool_portfolio_overview,
    "project_audit": tool_project_audit_summary,
    "equity_models": tool_equity_models,
}

def run_data_tools(tool_names: list, member_name: str, family_arg: str | None, project_id: str | None = None) -> str:
    """Execute the data tools the Manager selected; return concatenated structured results."""
    out = []
    for t in tool_names or []:
        try:
            if t == "my_family":
                out.append(tool_my_family(member_name))
            elif t == "family":
                out.append(tool_family(family_arg))
            elif t == "all_families":
                out.append(tool_all_families())
            elif t == "club_summary":
                out.append(tool_club_summary())
            elif t == "expenditure":
                out.append(tool_expenditure())
            elif t == "my_payments":
                out.append(tool_my_payments(member_name))
            elif t == "project_analysis":
                out.append(tool_project_analysis(project_id or "trees"))
            elif t == "portfolio_overview":
                out.append(tool_portfolio_overview())
            elif t == "project_audit":
                out.append(tool_project_audit_summary(project_id or "trees"))
            elif t == "equity_models":
                out.append(tool_equity_models(member_name))
        except Exception as e:
            log.warning(f"Data tool '{t}' failed: {e}")
    return "\n\n".join(x for x in out if x)


# ── Manager node ───────────────────────────────────────────────────────────────
_ROUTING_PROMPT = """You are the routing manager for KimFam Hub AI — an assistant for a Ugandan family investment club.

You decide which DATA TOOLS to call (live app data) and whether to query the document store (RAG).

QUESTION: {question}
ASKING MEMBER: {member}
THEIR FAMILY: {member_family}

CONVERSATION HISTORY (last few turns):
{history}

DATA TOOLS available (pick any that help answer; live PostgreSQL data):
- "my_family"     → the asking member's OWN family balance / what they still owe / their credit
- "family"        → a specific NAMED family's balance (also set "family" to that name, e.g. "Kofunas")
- "all_families"  → every family's balance (who is in arrears, who is paid up, totals)
- "club_summary"  → club totals, bank balance, expected vs confirmed reconciliation, total outstanding
- "expenditure"   → recorded club expenses (what money was spent on)
- "my_payments"        → the asking member's own payment submission history
- "project_analysis"   → LIVE financial metrics for a specific project: payback, ROI, revenue, capex.
                          Also set "project_id" to: trees, sheep, washing_bay, irrigation, dairy, bees, chicken
- "portfolio_overview" → LIVE snapshot of ALL projects key metrics side by side for comparison
- "project_audit"      → how numbers were calculated: assumptions, formulas, data gaps. Also set "project_id"
- "equity_models"      → the EQUITY VOTE: per-family stake under Models A/B/C (the KIM 008/2026 vote). Use for
                         "which equity model", "how does my family stand under A/B/C", "equity vote", "model A vs B".
                         Stay NEUTRAL: explain tradeoffs + show their numbers, never tell them how to vote.

RAG (document store) — set use_rag=true for:
- meetings (when/what decided/actions/latest) → doc_type_filter="minutes"
- constitution / rules / governance → doc_type_filter="constitution"
- project proposals / business plans → doc_type_filter="proposal"
- receipts → doc_type_filter="receipt"
- photos / videos / show me → doc_type_filter="proposal"

Guidance:
- "what does my family owe" / "am I paid up" / "my balance" → tools=["my_family"]
- "what does <Family> owe" → tools=["family"], family="<Family>"
- "who is in arrears" / "all balances" → tools=["all_families"]
- "how much is in the bank" / "are we in sync" / "club finances" → tools=["club_summary"]
- "what did we spend on X" / "expenses" → tools=["expenditure"]
- "my payment history" / "what have I paid" → tools=["my_payments"]
- "what is [project] payback/ROI/revenue/profit" → tools=["project_analysis"], project_id="<pid>"
- "how is the sheep project doing" / "how many sheep died / sheep deaths / mortality" / "sheep flock / how many sheep" / "sheep vaccines / vet / feed / expenses" / "money sent to buy lambs" → tools=["project_analysis"], project_id="sheep"
- "how was [metric] calculated" / "show assumptions" / "is [project] profitable" → tools=["project_audit"], project_id="<pid>"
- "rank projects" / "best investment" / "compare projects" / "portfolio" → tools=["portfolio_overview"]
- "equity model" / "model A vs B vs C" / "the vote" / "how does my family stand under each model" / "which model" → tools=["equity_models"], use_rag=true, doc_type_filter="constitution" (combine live numbers with the explainer doc; stay neutral)
- How to use the app / navigation / login / password / "how do I" / "where do I" / "show me how" → tools=[], use_rag=false (full app guide is in synthesizer, it covers every feature including washing bay income recording, equity analysis, admin panel, each tab)
- Greetings / off-topic → tools=[], use_rag=false

Respond ONLY with valid JSON, no explanation:
{{"tools": [], "family": null, "use_rag": true/false, "doc_type_filter": "minutes"|"constitution"|"proposal"|"report"|"receipt"|null, "is_followup": true/false, "project_id": null}}"""


def manager_node(state: KimFamState, sheet_context: str, progress_cb=None) -> KimFamState:
    history_text = "\n".join(
        f"Q: {t['q']}\nA: {t['a'][:200]}..." for t in state["conversation_history"][-3:]
    ) if state["conversation_history"] else "None"

    member = state["session_id"]
    member_family = _member_family_name(member) or "unknown"

    prompt = _ROUTING_PROMPT.format(
        question=state["question"],
        member=member,
        member_family=member_family,
        history=history_text,
    )

    try:
        raw = _chat(prompt, max_tokens=200).strip()
        raw = re.sub(r"^```json\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()
        routing = json.loads(raw)
    except Exception as e:
        log.warning(f"Manager routing failed, defaulting to summary+rag: {e}")
        routing = {"tools": ["club_summary"], "family": None, "use_rag": True,
                   "doc_type_filter": None, "is_followup": False}

    state["manager_routing"] = routing
    state["is_followup"] = routing.get("is_followup", False)

    # Emit a context-aware step based on what the router decided to fetch
    if progress_cb:
        _tl = {
            "my_family": "your family balance", "family": "family balance",
            "all_families": "all family balances", "club_summary": "club overview",
            "expenditure": "expenditure records", "my_payments": "your payments",
            "project_analysis": "project data", "portfolio_overview": "all projects",
            "project_audit": "audit figures",
        }
        tools = routing.get("tools", [])
        parts = [_tl.get(t, t) for t in tools if t in _tl]
        if routing.get("use_rag"):
            parts.append("documents")
        if parts:
            progress_cb("Checking " + ", ".join(parts[:3]) + "...")
        else:
            progress_cb("Gathering context...")

    # Sheet context always included — meeting register + actions are small and always relevant
    state["sheet_result"] = sheet_context

    # Run selected data tools (live structured app data)
    state["tool_result"] = run_data_tools(
        routing.get("tools", []), member, routing.get("family"),
        project_id=routing.get("project_id"))

    if routing.get("use_rag"):
        state["rag_result"] = rag_tool(state["question"], routing.get("doc_type_filter"))
    else:
        state["rag_result"] = ""

    return state


# ── Synthesizer node ───────────────────────────────────────────────────────────
def _get_app_guide() -> str:
    try:
        with open("/var/www/kimfamhub/docs/governance/app_guide.md", encoding="utf-8") as _f:
            return _f.read()
    except Exception:
        return "(app guide not available)"

_SYNTH_PROMPT_TEMPLATE = """You are KimFam Hub AI, the assistant for the KIM Investment Club — a Ugandan family investment club founded by the Arinda/Kikangi family.

The live data block includes today's date and the full 2026 meeting register — use these to answer questions about the latest or most recent anything.
Be helpful, warm, and concise. Cite your source (e.g., "from the May 2026 minutes" or "live data from the Sheet"). If you don't have the information, say so honestly rather than guessing.

APP GUIDE (use this to answer ANY questions about how to use KimFam Hub — how to log in, submit payments, record washing bay income, use the calculator, reset a password, navigate to any tab, etc.):
{app_guide}
--- END APP GUIDE ---
{history_block}

{tool_block}

{sheet_block}

{rag_block}

{media_block}

MEMBER QUESTION: {question}

Answer:"""




def synthesizer_node(state: KimFamState) -> KimFamState:
    history_block = ""
    if state["conversation_history"] and state["is_followup"]:
        turns = state["conversation_history"][-4:]
        history_block = "CONVERSATION HISTORY:\n" + "\n".join(
            f"Q: {t['q']}\nA: {t['a']}" for t in turns
        )

    sheet_block = f"LIVE FINANCIAL DATA (Google Sheet):\n{state['sheet_result']}" if state["sheet_result"] else ""
    rag_block = f"CLUB DOCUMENTS (retrieved):\n{state['rag_result']}" if state["rag_result"] else ""
    tool_block = f"LIVE APP DATA (authoritative — prefer this over the Sheet for balances/expenses):\n{state.get('tool_result','')}" if state.get("tool_result") else ""

    if not sheet_block and not rag_block and not tool_block:
        if state["is_followup"] and state["conversation_history"]:
            # Follow-up question — answer purely from conversation history
            pass  # fall through to synthesizer with history_block only
        else:
            state["answer"] = (
                "Hello! I'm KimFam Hub AI. You can ask me about the club's finances, "
                "meeting decisions, project proposals, or the constitution."
            )
            return state

    prompt = _SYNTH_PROMPT_TEMPLATE.format(
        app_guide=_get_app_guide(),
        history_block=history_block,
        tool_block=tool_block,
        sheet_block=sheet_block,
        rag_block=rag_block,
        media_block=MEDIA_CATALOG,
        question=state["question"],
    )

    try:
        state["answer"] = _chat(prompt, max_tokens=1024).strip()
    except Exception as e:
        log.error(f"Synthesizer failed: {e}")
        state["answer"] = "I'm having trouble generating an answer right now. Please try again."

    return state


# ── Fallback LLMs ──────────────────────────────────────────────────────────────
def _fallback_answer(prompt: str) -> str | None:
    """Try Gemini then Groq if OpenAI fails."""
    import time
    try:
        from google import genai as genai_client
        gc = genai_client.Client(api_key=os.getenv("GEMINI_API_KEY", ""))
        for model in ["gemini-2.5-flash", "gemini-2.5-flash-lite"]:
            try:
                response = gc.models.generate_content(model=model, contents=prompt)
                return response.text
            except Exception:
                time.sleep(1)
    except Exception:
        pass

    try:
        from groq import Groq
        gc2 = Groq(api_key=os.getenv("GROQ_API_KEY", ""))
        completion = gc2.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt[:120000]}],
            max_tokens=1024,
        )
        return completion.choices[0].message.content
    except Exception:
        pass

    return None


# ── Main entry point ───────────────────────────────────────────────────────────
def ask(question: str, session_id: str, sheet_context: str, progress_cb=None) -> str:
    """
    Run the full agentic flow and return the answer string.
    sheet_context: pre-built live data string from main.py's _get_live_context()
    """
    history = load_history(session_id)

    state: KimFamState = {
        "question": question,
        "session_id": session_id,
        "conversation_history": history,
        "is_followup": False,
        "manager_routing": {},
        "sheet_result": "",
        "rag_result": "",
        "tool_result": "",
        "answer": "",
    }

    def _step(msg):
        if progress_cb:
            try: progress_cb(msg)
            except Exception: pass

    try:
        _step("Routing your question...")
        state = manager_node(state, sheet_context, progress_cb=_step)
        _step("Generating your answer...")
        state = synthesizer_node(state)
        answer = state["answer"]
    except Exception as e:
        log.error(f"Agent graph failed: {e}")
        # Fallback: dump context directly
        fallback_prompt = (
            f"You are KimFam Hub AI. Answer this question for a family investment club member.\n\n"
            f"LIVE DATA:\n{sheet_context}\n\nQUESTION: {question}\n\nAnswer:"
        )
        answer = _fallback_answer(fallback_prompt) or "All AI services are busy right now. Please try again in a minute."

    save_turn(session_id, question, answer)
    return answer
