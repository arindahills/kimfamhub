#!/usr/bin/env python3
"""Run decision extraction (ADR-034) over stored meeting transcripts, on the server, with Claude.

    python3 scripts/decision_extract.py KIM\\ 017/2026            one meeting by ref
    python3 scripts/decision_extract.py --all                      every meeting that has a transcript or key decisions
Prints counts only (never quotes). Idempotent: running it again adds nothing already stored. Meetings flagged private are skipped.
The model is the Claude CLI, the same route the Hub uses (HOME=/root)."""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def claude(prompt, timeout=240, model="sonnet"):
    env = dict(os.environ)
    env["HOME"] = "/root"
    for attempt in range(2):
        try:
            # the prompt goes on stdin: a long transcript chunk as an argument exceeds the OS limit (MAX_ARG_STRLEN)
            r = subprocess.run(["claude", "-p", "--model", model], input=prompt, capture_output=True, text=True, timeout=timeout, env=env)
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.strip()
        except (subprocess.TimeoutExpired, OSError):
            pass
        time.sleep(3)
    return ""


def main():
    import decision_trace as dt
    from db import query as q
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    if not dt.ready():
        print("decision register tables unavailable")
        return 1
    if args[0] == "--all":
        meetings = q("SELECT id, ref FROM meetings WHERE coalesce(length(transcript),0) > 0 OR coalesce(length(key_decisions),0) > 0 ORDER BY date")
    else:
        meetings = q("SELECT id, ref FROM meetings WHERE ref=%s", (" ".join(args),))
    total = 0
    for m in meetings:
        t0 = time.time()
        try:
            out = dt.extract_meeting(m["id"], claude)
        except Exception as e:                      # one bad meeting never stops the others
            out = {"status": "error", "found": 0, "added": 0, "message": repr(e)[:120]}
        total += out.get("added", 0)
        print("%-14s %-8s found=%-3s added=%-3s %.0fs %s" % (m["ref"], out["status"], out.get("found", 0), out.get("added", 0), time.time() - t0, out.get("message", "")), flush=True)
    print("done: %d new decisions" % total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
