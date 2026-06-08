#!/usr/bin/env python3
"""
Nightly knowledge digest for KimFam Hub.
Fetches all project detail endpoints, generates a markdown snapshot,
and re-embeds it into ChromaDB so Ask KimFam always has current numbers.
"""

import os, sys, json, logging, datetime
import urllib.request as _ur

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("nightly_digest")

BASE_DIR = "/var/www/kimfamhub"
INTERNAL_KEY = os.environ.get("KIMFAM_INTERNAL_KEY", "")
PROJECTS = ["trees", "sheep", "washing_bay", "irrigation", "dairy", "bees", "chicken"]
NAMES = {
    "trees": "Tree Planting", "sheep": "Sheep", "washing_bay": "Washing Bay",
    "irrigation": "Irrigation/Bananas", "dairy": "Dairy", "bees": "Beekeeping",
    "chicken": "Chicken",
}
DIGEST_PATH = os.path.join(BASE_DIR, "docs", "governance", "financial_snapshot.md")


def fetch(path):
    try:
        req = _ur.Request(
            f"http://127.0.0.1:8000/{path}",
            headers={"X-Internal-Key": INTERNAL_KEY}
        )
        with _ur.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        log.warning(f"fetch {path}: {e}")
        return {}


def build_digest():
    today = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    lines = [
        "# KimFam Financial Snapshot",
        f"Generated: {today} (auto-updated nightly)",
        "",
        "This document is automatically generated. It reflects live financial metrics",
        "for all club projects as of today. Ask KimFam AI uses this to answer questions",
        "about current performance, payback periods, and ROI.",
        "",
    ]

    for pid in PROJECTS:
        d = fetch(f"api/projects/{pid}/detail")
        name = NAMES.get(pid, pid)
        lines.append(f"## {name}")

        if not d:
            lines.append("Data unavailable.")
            lines.append("")
            continue

        ov = d.get("overview", {})
        if isinstance(ov, dict):
            for k, v in ov.items():
                if not isinstance(v, (dict, list)):
                    lines.append(f"- **{k.replace('_',' ').title()}**: {v}")

        inv = d.get("investment", {})
        if isinstance(inv, dict) and inv:
            lines.append("")
            lines.append("**Investment:**")
            for k, v in inv.items():
                if not isinstance(v, (dict, list)):
                    lines.append(f"- {k.replace('_',' ').title()}: {v}")

        fm = d.get("financial_metrics", {})
        if fm:
            lines.append("")
            lines.append("**Financial Metrics (live):**")
            for k, v in fm.items():
                lines.append(f"- {k.replace('_',' ').title()}: {v}")

        risks = d.get("risks", [])
        if risks:
            lines.append("")
            lines.append("**Key Risks:**")
            for r in risks[:4]:
                level = r.get("level", "")
                title = r.get("title", "")
                lines.append(f"- [{level}] {title}")

        lines.append("")

    return "\n".join(lines)


def embed_digest(content):
    """Upsert the digest into ChromaDB."""
    sys.path.insert(0, BASE_DIR)
    import chromadb as _chroma
    from sentence_transformers import SentenceTransformer

    client = _chroma.PersistentClient(path=os.path.join(BASE_DIR, "data", "chroma"))
    collection = client.get_or_create_collection("kimfam_docs")
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    words = content.split()
    chunk_size = 400
    overlap = 50
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap

    # Delete old snapshot chunks first
    try:
        existing = collection.get(where={"source": "financial_snapshot"})
        if existing["ids"]:
            collection.delete(ids=existing["ids"])
            log.info(f"Deleted {len(existing['ids'])} old snapshot chunks")
    except Exception as e:
        log.warning(f"Could not delete old chunks: {e}")

    embeddings = model.encode(chunks, normalize_embeddings=True).tolist()
    ids = [f"financial_snapshot_{j}" for j in range(len(chunks))]
    metas = [{"source": "financial_snapshot", "doc_type": "report"} for _ in chunks]

    collection.upsert(ids=ids, embeddings=embeddings, documents=chunks, metadatas=metas)
    log.info(f"Upserted {len(chunks)} chunks into ChromaDB")


def main():
    log.info("Starting nightly digest")
    content = build_digest()
    with open(DIGEST_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    log.info(f"Written digest to {DIGEST_PATH}")
    embed_digest(content)
    log.info("Nightly digest complete")


if __name__ == "__main__":
    main()
