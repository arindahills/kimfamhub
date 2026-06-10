#!/usr/bin/env python3
"""
Claude <-> Gemini design loop.

Screenshots a staging route at mobile viewport, then asks Gemini to:
  (a) critique it against docs/design-system.md   -> printed to stdout
  (b) generate an improved mockup image (nano banana) -> saved as PNG

Claude runs this after each staging deploy, reads the critique + Reads the
mockup PNG visually, implements, redeploys, and re-runs. Removes the human
screenshot/copy-paste step.

Usage:
    venv/bin/python design_review.py /projects
    venv/bin/python design_review.py /finances --no-mockup
"""
import os, sys, pathlib, argparse

ROOT = pathlib.Path(__file__).resolve().parents[2]          # kimfamhub/
HERE = pathlib.Path(__file__).resolve().parent              # tools/design-loop/
OUT = HERE / "out"; OUT.mkdir(exist_ok=True)
SPEC = (ROOT / "docs" / "design-system.md").read_text()

# ---- env -------------------------------------------------------------------
for line in (HERE / ".env").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
KEY = os.environ["GEMINI_API_KEY"]
PW = os.environ["STAGING_TEST_PASSWORD"]
BASE = os.environ.get("STAGING_URL", "https://staging.kimfamhub.com").rstrip("/")

CRITIQUE_MODEL = "gemini-2.5-flash"
IMAGE_MODEL = "gemini-2.5-flash-image"   # "nano banana"


def screenshot(route: str) -> bytes:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844},
                            device_scale_factor=3, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.goto(BASE)
        page.wait_for_selector("input[autocomplete='username']", timeout=15000)
        page.fill("input[autocomplete='username']", "Hillary")
        page.fill("input[type='password']", PW)
        page.click("button[type='submit']")
        page.wait_for_selector("nav", timeout=10000)
        page.goto(BASE + route)
        page.wait_for_timeout(2800)            # let data + fonts settle
        png = page.screenshot(full_page=True)
        b.close()
        return png


def critique(png: bytes, route: str) -> str:
    import time
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=KEY)
    prompt = f"""You are a senior mobile product designer reviewing a dark fintech app.

CANONICAL DESIGN SPEC (the screen must satisfy this):
{SPEC}

Critique the attached screenshot of route `{route}` AGAINST the spec.
Rules:
- Only list CONCRETE, actionable VISUAL gaps (spacing, alignment, colour,
  hierarchy, component shape). One fix per bullet, most important first.
- Do NOT praise. Do NOT restate things that are already correct.
- Be specific ("gap between pills too tight, needs ~12px" not "improve spacing").
- Max 8 bullets.
Finish with one line: `VERDICT: SHIP` or `VERDICT: ITERATE`."""
    contents = [prompt, types.Part.from_bytes(data=png, mime_type="image/png")]
    last = ""
    for attempt in range(4):                       # tolerate transient 429/503
        try:
            resp = client.models.generate_content(model=CRITIQUE_MODEL, contents=contents)
            return (resp.text or "").strip()
        except Exception as e:
            last = str(e)
            if attempt < 3:
                time.sleep(8 * (attempt + 1))
    return f"[critique unavailable after retries: {last[:200]}]"


def mockup(png: bytes, route: str) -> str | None:
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=KEY)
    prompt = f"""Redesign THIS exact mobile screen so it better satisfies the design spec below.
Keep ALL text, data, numbers, and content identical — only improve the visual
presentation (spacing, hierarchy, colour, component styling). Premium dark
fintech aesthetic, phone aspect ratio. Return an improved mockup image.

DESIGN SPEC:
{SPEC[:4000]}"""
    try:
        resp = client.models.generate_content(
            model=IMAGE_MODEL,
            contents=[prompt, types.Part.from_bytes(data=png, mime_type="image/png")],
        )
        for part in resp.candidates[0].content.parts:
            if getattr(part, "inline_data", None) and part.inline_data.data:
                path = OUT / f"{route.strip('/').replace('/', '_') or 'home'}_mockup.png"
                path.write_bytes(part.inline_data.data)
                return str(path)
    except Exception as e:
        print(f"[mockup unavailable: {e}]", file=sys.stderr)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("route", nargs="?", default="/projects")
    ap.add_argument("--no-mockup", action="store_true")
    args = ap.parse_args()

    print(f"→ screenshotting {BASE}{args.route} (mobile 390x844)…", file=sys.stderr)
    png = screenshot(args.route)
    shot = OUT / f"{args.route.strip('/').replace('/', '_') or 'home'}_current.png"
    shot.write_bytes(png)
    print(f"   saved {shot}", file=sys.stderr)

    print("\n================ GEMINI CRITIQUE ================")
    print(critique(png, args.route))

    if not args.no_mockup:
        print("\n================ MOCKUP ================", file=sys.stderr)
        m = mockup(png, args.route)
        if m:
            print(f"MOCKUP_IMAGE: {m}")
        else:
            print("MOCKUP_IMAGE: (none)")


if __name__ == "__main__":
    main()
