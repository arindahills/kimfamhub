#!/usr/bin/env python3
"""
CI self-heal script.
Reads test failure logs, calls Claude API, writes fixes back to disk.
Exit 0 = fixes applied (caller should commit + push).
Exit 2 = no failures found (nothing to fix).
Exit 1 = Claude could not produce a fix.

Usage:
  python3 scripts/self_heal.py \
    --unit-log /tmp/unit_output.txt \
    --smoke-log /tmp/smoke_output.txt
"""

import argparse, json, os, sys, textwrap

import anthropic

APP_FILES = [
    "main.py", "auth.py", "ask_agent.py", "scheduler.py",
    "contributions.py", "notifications.py", "r2_storage.py",
    "family_profiles.py", "family_db.py", "db.py",
    "tests/test_api.py", "tests/test_smoke.py",
]

SYSTEM = textwrap.dedent("""
    You are a senior Python engineer fixing a FastAPI application called KimFam Hub.
    The CI pipeline has failed. Your job is to produce the minimal code changes
    that make the failing tests pass without breaking passing tests.

    Rules:
    - Only change what is necessary. Do not refactor, rename, or reformat unrelated code.
    - Do not add new features, tests, or comments beyond what fixes the failure.
    - Your response must be a single valid JSON object — nothing before or after it.
    - The JSON schema is:
      {
        "explanation": "<one sentence: root cause and what you changed>",
        "files": {
          "<relative/path.py>": "<complete new file content as a string>"
        }
      }
    - Only include files that actually need to change.
    - If the failure is in a test file, fix the test. If it is in app code, fix the app.
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


def call_claude(failure_log: str, sources: dict) -> dict:
    source_block = "\n\n".join(
        f"--- {path} ---\n{content}" for path, content in sources.items()
    )
    user_msg = (
        f"The following tests failed in CI:\n\n{failure_log}\n\n"
        f"Here are the relevant source files:\n\n{source_block}\n\n"
        "Produce the JSON fix as described in your instructions."
    )

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8192,
        system=SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    )
    raw = response.content[0].text.strip()

    # Strip any accidental markdown fences
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]

    return json.loads(raw.strip())


def apply_fixes(result: dict) -> int:
    files_changed = result.get("files", {})
    if not files_changed:
        print("Claude: no fix produced.")
        return 0

    for path, content in files_changed.items():
        # Safety: only allow paths inside the repo (no absolute or traversal)
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
        print("No failures detected in logs — nothing to fix.")
        sys.exit(2)

    print("Failure detected. Calling Claude for a fix...")
    sources = load_sources()

    try:
        result = call_claude(failure_log, sources)
    except json.JSONDecodeError as e:
        print(f"Claude returned invalid JSON: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Claude API error: {e}")
        sys.exit(1)

    n = apply_fixes(result)
    if n == 0:
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
