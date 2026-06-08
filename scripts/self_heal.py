#!/usr/bin/env python3
"""
CI self-heal script.
Reads test failure logs, calls Gemini (Groq fallback), writes fixes to disk.

Exit 0 = fixes applied (caller should commit + push).
Exit 2 = no failures found (nothing to fix).
Exit 1 = AI could not produce a fix.

Usage:
  python3 scripts/self_heal.py \
    --unit-log /tmp/unit_output.txt \
    --smoke-log /tmp/smoke_output.txt
"""

import argparse, json, os, sys, textwrap

APP_FILES = [
    "main.py", "auth.py", "ask_agent.py", "scheduler.py",
    "contributions.py", "notifications.py", "r2_storage.py",
    "family_profiles.py", "family_db.py", "db.py",
    "tests/test_api.py", "tests/test_smoke.py",
]

SYSTEM = textwrap.dedent("""
    You are a senior Python engineer fixing a FastAPI application called KimFam Hub.
    The CI pipeline has failed. Produce the minimal code changes that make the
    failing tests pass without breaking passing tests.

    Rules:
    - Only change what is necessary. Do not refactor, rename, or reformat unrelated code.
    - Do not add new features, tests, or comments beyond what fixes the failure.
    - Your response must be a single valid JSON object — nothing before or after it.
    - Schema:
      {
        "explanation": "<one sentence: root cause and fix>",
        "files": {
          "<relative/path.py>": "<complete new file content>"
        }
      }
    - Only include files that need to change.
    - Fix the test if the test is wrong; fix the app if the app is wrong.
    - If you cannot determine a safe fix, return: {"explanation": "cannot fix", "files": {}}
""").strip()


def read_file(path: str) -> str:
    try:
        return open(path).read()
    except FileNotFoundError:
        return ""


def load_logs(unit_log: str, smoke_log: str) -> str:
    parts = []
    for label, path in [("UNIT TEST OUTPUT", unit_log), ("SMOKE TEST OUTPUT", smoke_log)]:
        content = read_file(path).strip()
        if content and ("FAILED" in content or "ERROR" in content or "error" in content.lower()):
            parts.append(f"=== {label} ===\n{content}")
    return "\n\n".join(parts)


def load_sources() -> dict:
    return {p: read_file(p) for p in APP_FILES if read_file(p)}


def _parse_response(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    return json.loads(raw.strip())


def call_gemini(failure_log: str, sources: dict) -> dict:
    import google.generativeai as genai
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=SYSTEM,
    )
    source_block = "\n\n".join(f"--- {p} ---\n{c}" for p, c in sources.items())
    prompt = (
        f"Tests failed:\n\n{failure_log}\n\n"
        f"Source files:\n\n{source_block}\n\n"
        "Produce the JSON fix."
    )
    response = model.generate_content(prompt)
    return _parse_response(response.text)


def call_groq(failure_log: str, sources: dict) -> dict:
    from groq import Groq
    client = Groq(api_key=os.environ["GROQ_API_KEY"])
    source_block = "\n\n".join(f"--- {p} ---\n{c}" for p, c in sources.items())
    user_msg = (
        f"Tests failed:\n\n{failure_log}\n\n"
        f"Source files:\n\n{source_block}\n\n"
        "Produce the JSON fix."
    )
    resp = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user",   "content": user_msg},
        ],
        max_tokens=8192,
    )
    return _parse_response(resp.choices[0].message.content)


def call_ai(failure_log: str, sources: dict) -> dict:
    if os.environ.get("GEMINI_API_KEY"):
        try:
            print("Trying Gemini...")
            return call_gemini(failure_log, sources)
        except Exception as e:
            print(f"Gemini failed: {e} — falling back to Groq")
    if os.environ.get("GROQ_API_KEY"):
        print("Trying Groq...")
        return call_groq(failure_log, sources)
    raise RuntimeError("No AI provider available. Set GEMINI_API_KEY or GROQ_API_KEY.")


def apply_fixes(result: dict) -> int:
    files_changed = result.get("files", {})
    if not files_changed:
        print("AI returned no fix.")
        return 0
    for path, content in files_changed.items():
        if path.startswith("/") or ".." in path:
            print(f"SKIP unsafe path: {path}")
            continue
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w") as f:
            f.write(content)
        print(f"Fixed: {path}")
    print(f"\nExplanation: {result.get('explanation', '(none)')}")
    return len(files_changed)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--unit-log",  default="/tmp/unit_output.txt")
    parser.add_argument("--smoke-log", default="/tmp/smoke_output.txt")
    args = parser.parse_args()

    failure_log = load_logs(args.unit_log, args.smoke_log)
    if not failure_log:
        print("No failures in logs.")
        sys.exit(2)

    print("Failures found. Calling AI for a fix...")
    sources = load_sources()

    try:
        result = call_ai(failure_log, sources)
    except json.JSONDecodeError as e:
        print(f"AI returned invalid JSON: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"AI error: {e}")
        sys.exit(1)

    n = apply_fixes(result)
    sys.exit(0 if n > 0 else 1)


if __name__ == "__main__":
    main()
