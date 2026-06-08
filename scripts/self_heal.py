#!/usr/bin/env python3
"""
CI self-heal script. Runs ON Hetzner (where Claude Code CLI is authenticated).

Reads test failure logs, calls `claude -p` (subscription, no API key needed),
writes fixes back to the staging directory.

Exit 0 = fixes applied.
Exit 2 = no failures found.
Exit 1 = could not produce a fix.

Usage (run from /var/www/kimfamhub-staging):
  python3 scripts/self_heal.py \
    --unit-log /tmp/unit_output.txt \
    --smoke-log /tmp/smoke_output.txt
"""

import argparse, json, os, subprocess, sys, textwrap

APP_FILES = [
    "main.py", "auth.py", "ask_agent.py", "scheduler.py",
    "contributions.py", "notifications.py", "r2_storage.py",
    "family_profiles.py", "family_db.py", "db.py",
    "tests/test_api.py", "tests/test_smoke.py",
]

PROMPT_TEMPLATE = textwrap.dedent("""
    You are a senior Python engineer fixing a FastAPI application called KimFam Hub.
    CI tests have failed. Produce the minimal code changes to make them pass.

    Rules:
    - Only change what is necessary. Do not refactor unrelated code.
    - Do not add features, tests, or comments beyond what fixes the failure.
    - Respond ONLY with a single valid JSON object — no markdown, no explanation outside JSON.
    - Schema:
      {{
        "explanation": "<one sentence: root cause and fix>",
        "files": {{
          "<relative/path.py>": "<complete new file content>"
        }}
      }}
    - Fix the test if the test is wrong; fix the app if the app is wrong.
    - If you cannot determine a safe fix return: {{"explanation": "cannot fix", "files": {{}}}}

    === FAILING TEST OUTPUT ===
    {failure_log}

    === SOURCE FILES ===
    {source_block}

    Produce the JSON fix now.
""").strip()


def read_file(path: str) -> str:
    try:
        return open(path).read()
    except FileNotFoundError:
        return ""


def load_logs(unit_log: str, smoke_log: str) -> str:
    parts = []
    for label, path in [("UNIT TESTS", unit_log), ("SMOKE TESTS", smoke_log)]:
        content = read_file(path).strip()
        if content and ("FAILED" in content or "ERROR" in content):
            parts.append(f"--- {label} ---\n{content}")
    return "\n\n".join(parts)


def load_sources() -> str:
    chunks = []
    for p in APP_FILES:
        content = read_file(p)
        if content:
            chunks.append(f"--- {p} ---\n{content}")
    return "\n\n".join(chunks)


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    return json.loads(raw.strip())


def call_claude_cli(prompt: str) -> dict:
    """Use the Claude Code CLI (authenticated via subscription on this server)."""
    result = subprocess.run(
        ["claude", "-p", prompt, "--model", "sonnet"],
        capture_output=True, text=True, timeout=180,
    )
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI error: {result.stderr[:300]}")
    return _parse_json(result.stdout)


def call_gemini(prompt: str) -> dict:
    import google.generativeai as genai
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel("gemini-2.5-flash")
    response = model.generate_content(prompt)
    return _parse_json(response.text)


def call_groq(prompt: str) -> dict:
    from groq import Groq
    client = Groq(api_key=os.environ["GROQ_API_KEY"])
    resp = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=8192,
    )
    return _parse_json(resp.choices[0].message.content)


def call_ai(prompt: str) -> dict:
    # Primary: Claude Code CLI (subscription, no key needed)
    try:
        print("Calling Claude CLI...")
        return call_claude_cli(prompt)
    except Exception as e:
        print(f"Claude CLI failed: {e}")

    # Fallback: Gemini
    if os.environ.get("GEMINI_API_KEY"):
        try:
            print("Falling back to Gemini...")
            return call_gemini(prompt)
        except Exception as e:
            print(f"Gemini failed: {e}")

    # Last resort: Groq
    if os.environ.get("GROQ_API_KEY"):
        try:
            print("Falling back to Groq...")
            return call_groq(prompt)
        except Exception as e:
            print(f"Groq failed: {e}")

    raise RuntimeError("All AI providers failed.")


def apply_fixes(result: dict) -> int:
    files_changed = result.get("files", {})
    if not files_changed:
        print("AI: no fix produced.")
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
        print("No failures detected — nothing to fix.")
        sys.exit(2)

    print("Failures found. Asking Claude for a fix...")
    prompt = PROMPT_TEMPLATE.format(
        failure_log=failure_log,
        source_block=load_sources(),
    )

    try:
        result = call_ai(prompt)
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
