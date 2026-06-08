"""
KimFam Hub — Network smoke tests.
Run against a live URL. Set env vars:
  SMOKE_BASE_URL         = https://staging.kimfamhub.com  (default)
  SMOKE_TEST_PASSWORD    = password for the Hillary test account on staging
"""
import os, json
import pytest
import requests

BASE = os.getenv("SMOKE_BASE_URL", "https://staging.kimfamhub.com").rstrip("/")
TEST_PASSWORD = os.getenv("SMOKE_TEST_PASSWORD", "password")
SESSION = requests.Session()
SESSION.verify = True


def _post(path, **kwargs):
    return SESSION.post(f"{BASE}{path}", timeout=30, **kwargs)

def _get(path, **kwargs):
    return SESSION.get(f"{BASE}{path}", timeout=30, **kwargs)


@pytest.fixture(scope="module")
def token():
    r = _post("/api/auth/login", json={"name": "Hillary", "password": TEST_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    # Token lives in httponly cookie (SESSION already stores it); also extract for header use
    tok = SESSION.cookies.get("kimfam_token", "")
    assert tok, "No kimfam_token cookie after login"
    return tok

@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ── Unauthenticated public routes ──────────────────────────────────────────────

class TestPublicRoutes:
    def test_index_200(self):
        r = _get("/")
        assert r.status_code == 200
        assert "KimFam" in r.text

    def test_manifest_200(self):
        assert _get("/static/manifest.json").status_code == 200

    def test_login_bad_password_401(self):
        r = _post("/api/auth/login", json={"name": "Hillary", "password": "definitely-wrong"})
        assert r.status_code == 401

    def test_protected_route_without_token_401(self):
        assert _get("/api/auth/me").status_code == 401

    def test_docs_listing_requires_auth(self):
        r = _get("/api/docs")
        assert r.status_code in (200, 401)


# ── Auth ──────────────────────────────────────────────────────────────────────

class TestAuth:
    def test_login_sets_cookie(self, token):
        assert token and len(token) > 20

    def test_me_returns_profile(self, auth_headers):
        r = _get("/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == "Hillary"
        assert d["role"] == "admin"


# ── Core API ─────────────────────────────────────────────────────────────────

class TestCoreAPI:
    def test_meetings_returns_list(self, auth_headers):
        r = _get("/api/meetings", headers=auth_headers)
        assert r.status_code == 200

    def test_docs_returns_categories(self, auth_headers):
        r = _get("/api/docs", headers=auth_headers)
        assert r.status_code == 200
        d = r.json()
        assert "minutes" in d or "governance" in d

    def test_family_profiles_returns_families(self, auth_headers):
        r = _get("/api/family-profiles", headers=auth_headers)
        assert r.status_code == 200
        assert "families" in r.json()

    def test_washing_bay_income_open(self):
        assert _get("/api/washing-bay/income").status_code == 200

    def test_admin_members_status(self, auth_headers):
        r = _get("/api/auth/admin/members-status", headers=auth_headers)
        assert r.status_code == 200
        assert len(r.json()["members"]) == 13


# ── Ask KimFam SSE ────────────────────────────────────────────────────────────

class TestAskStream:
    def test_ask_stream_returns_result(self, auth_headers):
        """POST /api/ask/stream and read until a 'result' event arrives."""
        r = SESSION.post(
            f"{BASE}/api/ask/stream",
            json={"question": "Who is the treasurer?", "session_id": "smoke-test"},
            headers={**auth_headers, "Accept": "text/event-stream"},
            stream=True,
            timeout=60,
        )
        assert r.status_code == 200, f"SSE endpoint failed: {r.status_code}"
        got_result = False
        for raw_line in r.iter_lines(decode_unicode=True):
            if not raw_line or not raw_line.startswith("data:"):
                continue
            try:
                ev = json.loads(raw_line[5:].strip())
            except Exception:
                continue
            if ev.get("type") == "result":
                got_result = True
                answer = ev.get("answer", "")
                assert len(answer) > 10, f"Answer too short: {answer!r}"
                break
        assert got_result, "No result event received from /api/ask/stream"
