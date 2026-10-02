"""
KimFam Hub — Backend API Tests
Run: venv/bin/pytest tests/test_api.py -v
"""
import os, sys, tempfile, shutil
import pytest

_tmp_dir = tempfile.mkdtemp()
os.environ["KIMFAM_DB_PATH"] = os.path.join(_tmp_dir, "test.db")
os.environ["JWT_SECRET"]      = "test-secret-for-pytest-32-chars!!"
os.environ["WASHING_BAY_PIN"] = "99999"
os.environ["INTERNAL_API_KEY"]= "test-internal-key"
os.environ["SCHEDULER_ENABLED"] = "0"  # never start APScheduler in tests

# Support running from Hetzner prod dir, staging dir, or local Mac checkout.
# KIMFAM_APP_ROOT can be set explicitly; otherwise derive from this file's location.
_APP_ROOT = os.environ.get(
    "KIMFAM_APP_ROOT",
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
sys.path.insert(0, _APP_ROOT)
import auth, family_profiles
auth.DB_PATH = os.environ["KIMFAM_DB_PATH"]
family_profiles.DB_PATH = os.environ["KIMFAM_DB_PATH"]

from main import app
from fastapi.testclient import TestClient
client = TestClient(app, raise_server_exceptions=True)


@pytest.fixture(autouse=True, scope="session")
def seed_db():
    auth.seed_members()
    family_profiles.seed_family_profiles()
    # Set passwords and immediately clear must_change_password for primary accounts
    for name, pw in [("Hillary","TestPass1"),("Hellen","TestPass2"),
                     ("Alex","TestPass3"),("Esther","TestPass4")]:
        auth.set_password(name, pw)
        auth.change_password(name, pw, pw)   # clears must_change_password flag
    yield
    shutil.rmtree(_tmp_dir, ignore_errors=True)


def _login(name, password):
    """Login and return the JWT token (extracted from the httponly cookie)."""
    r = client.post("/api/auth/login", json={"name": name, "password": password})
    assert r.status_code == 200, f"Login failed for {name}: {r.text}"
    # Token is set as httponly cookie; TestClient stores it in its cookie jar.
    # Extract it so callers can pass it as an Authorization header when needed.
    token = r.cookies.get("kimfam_token") or client.cookies.get("kimfam_token", "")
    assert token, f"No kimfam_token cookie in login response for {name}"
    return token

def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ── Auth ──────────────────────────────────────────────────────────────────────

class TestAuth:
    def test_login_valid(self):
        r = client.post("/api/auth/login", json={"name":"Hillary","password":"TestPass1"})
        assert r.status_code == 200
        d = r.json()
        # Token is in the httponly cookie, not the body
        assert d["name"] == "Hillary"
        assert d["role"] == "admin"
        assert d["must_change_password"] is False
        assert "kimfam_token" in r.cookies

    def test_login_wrong_password(self):
        r = client.post("/api/auth/login", json={"name":"Hillary","password":"wrong"})
        assert r.status_code == 401

    def test_login_unknown_user(self):
        r = client.post("/api/auth/login", json={"name":"Boaz","password":"anything"})
        assert r.status_code == 401

    def test_login_missing_fields(self):
        r = client.post("/api/auth/login", json={"name":"Hillary"})
        assert r.status_code == 400

    def test_me_valid_token(self):
        token = _login("Hillary", "TestPass1")
        r = client.get("/api/auth/me", headers=_auth(token))
        assert r.status_code == 200
        assert r.json()["name"] == "Hillary"

    def test_me_no_token(self):
        # Use a fresh client with no cookies to simulate unauthenticated request
        from fastapi.testclient import TestClient as _TC
        fresh = _TC(app, raise_server_exceptions=True)
        assert fresh.get("/api/auth/me").status_code == 401

    def test_me_bad_token(self):
        # Fresh client: no cookie, only a bad bearer — must be rejected
        from fastapi.testclient import TestClient as _TC
        fresh = _TC(app, raise_server_exceptions=True)
        r = fresh.get("/api/auth/me", headers={"Authorization": "Bearer rubbish"})
        assert r.status_code == 401

    def test_change_password_valid(self):
        auth.set_password("Esther", "OldPass1")
        auth.change_password("Esther", "OldPass1", "OldPass1")
        token = _login("Esther", "OldPass1")
        r = client.post("/api/auth/change-password", headers=_auth(token),
                        json={"old_password":"OldPass1","new_password":"NewPass99"})
        assert r.status_code == 200
        assert client.post("/api/auth/login",
                           json={"name":"Esther","password":"NewPass99"}).status_code == 200
        assert client.post("/api/auth/login",
                           json={"name":"Esther","password":"OldPass1"}).status_code == 401

    def test_change_password_wrong_old(self):
        token = _login("Hillary", "TestPass1")
        r = client.post("/api/auth/change-password", headers=_auth(token),
                        json={"old_password":"wrongold","new_password":"NewPass2"})
        assert r.status_code == 400

    def test_change_password_too_short(self):
        token = _login("Hillary", "TestPass1")
        r = client.post("/api/auth/change-password", headers=_auth(token),
                        json={"old_password":"TestPass1","new_password":"ab"})
        assert r.status_code == 400

    def test_must_change_password_set_by_admin(self):
        auth.set_password("Alex", "FreshPass1")   # set_password always sets flag
        r = client.post("/api/auth/login", json={"name":"Alex","password":"FreshPass1"})
        assert r.status_code == 200
        assert r.json()["must_change_password"] is True


# ── Admin Endpoints ───────────────────────────────────────────────────────────

class TestAdminEndpoints:
    def test_members_status_as_hillary(self):
        token = _login("Hillary", "TestPass1")
        r = client.get("/api/auth/admin/members-status", headers=_auth(token))
        assert r.status_code == 200
        names = [m["name"] for m in r.json()["members"]]
        assert len(names) == 13
        assert "Hillary" in names and "Hellen" in names

    def test_members_status_as_regular_member(self):
        token = _login("Alex", "FreshPass1")
        assert client.get("/api/auth/admin/members-status",
                          headers=_auth(token)).status_code == 403

    def test_members_status_as_israel(self):
        # Israel has role=admin but is NOT in ADMIN_USERS {Hillary, Hellen}
        auth.set_password("Israel", "IsraelPass1")
        auth.change_password("Israel", "IsraelPass1", "IsraelPass1")
        token = _login("Israel", "IsraelPass1")
        assert client.get("/api/auth/admin/members-status",
                          headers=_auth(token)).status_code == 403

    def test_set_password_as_hillary(self):
        token = _login("Hillary", "TestPass1")
        r = client.post("/api/auth/admin/set-password", headers=_auth(token),
                        json={"name":"Max","password":"MaxNewPass1"})
        assert r.status_code == 200
        assert client.post("/api/auth/login",
                           json={"name":"Max","password":"MaxNewPass1"}).status_code == 200

    def test_set_password_as_non_admin(self):
        token = _login("Alex", "FreshPass1")
        assert client.post("/api/auth/admin/set-password", headers=_auth(token),
                           json={"name":"Max","password":"MaxNewPass2"}).status_code == 403

    def test_set_password_too_short(self):
        token = _login("Hillary", "TestPass1")
        assert client.post("/api/auth/admin/set-password", headers=_auth(token),
                           json={"name":"Max","password":"abc"}).status_code == 400


# ── Family Profiles ───────────────────────────────────────────────────────────

class TestFamilyProfiles:
    def test_get_all_authenticated(self):
        token = _login("Hillary", "TestPass1")
        r = client.get("/api/family-profiles", headers=_auth(token))
        assert r.status_code == 200
        families = r.json()["families"]
        assert len(families) == 7
        ids = [f["family_id"] for f in families]
        for expected in ["kikangis","tuhimbises","turamyes","arungas","arihos","arindas","kofunas"]:
            assert expected in ids

    def test_get_unauthenticated(self):
        from fastapi.testclient import TestClient as _TC
        assert _TC(app, raise_server_exceptions=True).get("/api/family-profiles").status_code == 401

    def test_kikangis_has_six_children(self):
        token = _login("Hillary", "TestPass1")
        r = client.get("/api/family-profiles", headers=_auth(token))
        kikangis = next(f for f in r.json()["families"] if f["family_id"] == "kikangis")
        assert len(kikangis["children"]) == 6

    def test_update_own_family(self):
        token = _login("Hillary", "TestPass1")
        children = [
            {"name":"Ethan Ahumuza Arinda","birthday":"29 Oct 2021","adopted":False,"on_obligations":True},
            {"name":"Hansel Arinda","birthday":"18 Nov 2022","adopted":False,"on_obligations":True},
            {"name":"Test Baby","birthday":"1 Jan 2025","adopted":False,"on_obligations":True},
        ]
        assert client.put("/api/family-profiles/arindas", headers=_auth(token),
                          json={"children": children}).status_code == 200
        r = client.get("/api/family-profiles", headers=_auth(token))
        arindas = next(f for f in r.json()["families"] if f["family_id"] == "arindas")
        assert len(arindas["children"]) == 3
        assert arindas["children"][2]["name"] == "Test Baby"

    def test_cannot_edit_another_family(self):
        token = _login("Hillary", "TestPass1")
        assert client.put("/api/family-profiles/kofunas", headers=_auth(token),
                          json={"children": [{"name":"Hacker","birthday":"",
                                              "adopted":False,"on_obligations":True}]}
                          ).status_code == 403

    def test_update_unauthenticated(self):
        from fastapi.testclient import TestClient as _TC
        assert _TC(app, raise_server_exceptions=True).put(
            "/api/family-profiles/arindas", json={"children": []}
        ).status_code == 401

    def test_hellen_edits_kofunas(self):
        token = _login("Hellen", "TestPass2")
        r = client.put("/api/family-profiles/kofunas", headers=_auth(token),
                       json={"children": [
                           {"name":"Lael Tirzah Kofuna","birthday":"28 Oct 2022",
                            "adopted":False,"on_obligations":True},
                           {"name":"Lainey Tate Kofuna","birthday":"6 Jan 2026",
                            "adopted":False,"on_obligations":True},
                       ]})
        assert r.status_code == 200

    def test_adopted_flag_preserved(self):
        auth.set_password("Alex", "AlexPass2")
        auth.change_password("Alex", "AlexPass2", "AlexPass2")
        token = _login("Alex", "AlexPass2")
        r = client.put("/api/family-profiles/tuhimbises", headers=_auth(token),
                       json={"children": [
                           {"name":"Faith","birthday":"","adopted":True,"on_obligations":False},
                           {"name":"Elijah","birthday":"2 Aug 2020","adopted":False,"on_obligations":True},
                       ]})
        assert r.status_code == 200
        hilary_token = _login("Hillary", "TestPass1")
        families = client.get("/api/family-profiles", headers=_auth(hilary_token)).json()["families"]
        tuhimbises = next(f for f in families if f["family_id"] == "tuhimbises")
        faith = next(c for c in tuhimbises["children"] if c["name"] == "Faith")
        assert faith["adopted"] is True
        assert faith["on_obligations"] is False

    def test_nonexistent_family_rejected(self):
        token = _login("Hillary", "TestPass1")
        assert client.put("/api/family-profiles/nobody", headers=_auth(token),
                          json={"children": []}).status_code in (403, 404)


# ── Washing Bay ───────────────────────────────────────────────────────────────

class TestWashingBay:
    def test_get_income_open(self):
        assert client.get("/api/washing-bay/income").status_code == 200

    def test_post_income_valid_pin(self):
        r = client.post("/api/washing-bay/income",
                        json={"date":"2026-05-01","amount_ugx":50000,"pin":"99999",
                              "received_from":"Eli","collector":"Dad"})
        assert r.status_code == 200

    def test_post_income_wrong_pin(self):
        r = client.post("/api/washing-bay/income",
                        json={"date":"2026-05-01","amount_ugx":50000,"pin":"00000",
                              "received_from":"Eli","collector":"Dad"})
        assert r.status_code == 403

    def test_income_record_appears_in_list(self):
        # Post a record then verify it appears in GET
        client.post("/api/washing-bay/income",
                    json={"date":"2026-06-01","amount_ugx":75000,"pin":"99999",
                          "received_from":"Alex","collector":"Dad","notes":"test"})
        r = client.get("/api/washing-bay/income")
        records = r.json().get("records", [])
        amounts = [rec["amount_ugx"] for rec in records]
        assert 75000 in amounts


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


class TestKlaFamRecordFor:
    """Only this cycle's beneficiary (or an admin) may record a contribution RECEIVED FROM
    another member. The deny path cannot be exercised against prod (the only real account is
    an admin, who always passes) and staging has no klafam tables — so it is pinned here.
    db.query/db.execute are stubbed because the endpoint imports them inside the handler."""

    @staticmethod
    def _stub_db(monkeypatch, bene_slug, member_found=True, existing_status="pending", execs=None):
        import db as _db

        def fake_query(sql, params=None):
            s = " ".join(sql.split())
            if "information_schema.columns" in s:
                return [{"exists": 1}]                     # recorded_by already present
            if "FROM klafam_cycles" in s:
                return [{"id": 1, "bene_slug": bene_slug}]
            if "SUM(amount)" in s:
                return [{"t": 600000}]
            if "FROM klafam_members" in s:
                return [{"id": 7}] if member_found else []
            if "FROM klafam_contributions" in s:
                return [{"id": 55, "status": existing_status}] if existing_status else []
            return []

        def fake_execute(sql, params=None):
            if execs is not None:
                execs.append((" ".join(sql.split()), params))
            return None

        monkeypatch.setattr(_db, "query", fake_query)
        monkeypatch.setattr(_db, "execute", fake_execute)

    @staticmethod
    def _client_as(name, role="member"):
        """Mint the JWT directly rather than logging in — other tests in this file rotate
        Alex's and Esther's passwords, so the login flow is not dependable here."""
        import jwt as _jwt
        from datetime import datetime as _dtm, timezone as _tz, timedelta as _td
        from fastapi.testclient import TestClient as _TC
        tok = _jwt.encode(
            {"sub": name, "display": name, "role": role,
             "exp": _dtm.now(_tz.utc) + _td(hours=1)},
            os.environ["JWT_SECRET"], algorithm="HS256")
        c = _TC(app)
        c.cookies.set("kimfam_token", tok)
        return c

    def test_non_beneficiary_member_is_denied(self, monkeypatch):
        self._stub_db(monkeypatch, bene_slug="arindas")
        c = self._client_as("Alex")            # klafam 'alex', role member
        r = c.post("/api/klafam/contributions/record-for",
                   json={"cycle_id": 1, "member_slug": "priscilla"})
        assert r.status_code == 403

    def test_denied_when_cycle_has_no_beneficiary(self, monkeypatch):
        self._stub_db(monkeypatch, bene_slug=None)
        c = self._client_as("Alex")
        r = c.post("/api/klafam/contributions/record-for",
                   json={"cycle_id": 1, "member_slug": "priscilla"})
        assert r.status_code == 403                          # None == None must not authorise

    def test_beneficiary_records_and_is_attributed(self, monkeypatch):
        execs = []
        self._stub_db(monkeypatch, bene_slug="arindas", execs=execs)
        c = self._client_as("Esther")           # klafam 'arindas', NOT an admin
        r = c.post("/api/klafam/contributions/record-for",
                   json={"cycle_id": 1, "member_slug": "priscilla"})
        assert r.status_code == 200, r.text
        upd = [e for e in execs if "UPDATE klafam_contributions" in e[0]]
        assert upd and "Esther" in upd[0][1]                 # recorded_by attribution present

    def test_already_recorded_is_conflict_not_silent_overwrite(self, monkeypatch):
        self._stub_db(monkeypatch, bene_slug="arindas", existing_status="paid")
        c = self._client_as("Esther")
        r = c.post("/api/klafam/contributions/record-for",
                   json={"cycle_id": 1, "member_slug": "priscilla"})
        assert r.status_code == 409                          # never clobber the member's own entry

    def test_inactive_or_unknown_member_rejected(self, monkeypatch):
        self._stub_db(monkeypatch, bene_slug="arindas", member_found=False)
        c = self._client_as("Esther")
        r = c.post("/api/klafam/contributions/record-for",
                   json={"cycle_id": 1, "member_slug": "boaz"})
        assert r.status_code == 404                          # no phantom ledger rows

    def test_no_row_in_cycle_rejected(self, monkeypatch):
        self._stub_db(monkeypatch, bene_slug="arindas", existing_status=None)
        c = self._client_as("Esther")
        r = c.post("/api/klafam/contributions/record-for",
                   json={"cycle_id": 1, "member_slug": "priscilla"})
        assert r.status_code == 404

    def test_internal_key_records_with_whatsapp_attribution(self, monkeypatch):
        # The WhatsApp agent's ">> klafam confirm" path: admin-equivalent, same guards.
        execs = []
        self._stub_db(monkeypatch, bene_slug="arindas", execs=execs)
        monkeypatch.setenv("KIMFAM_INTERNAL_KEY", "test-internal-key")
        from fastapi.testclient import TestClient as _TC
        r = _TC(app).post("/api/klafam/contributions/record-for",
                          headers={"X-Internal-Key": "test-internal-key"},
                          json={"cycle_id": 1, "member_slug": "priscilla"})
        assert r.status_code == 200, r.text
        upd = [e for e in execs if "UPDATE klafam_contributions" in e[0]]
        assert upd and "Hillary (via WhatsApp)" in upd[0][1]

    def test_internal_key_still_refuses_to_clobber(self, monkeypatch):
        self._stub_db(monkeypatch, bene_slug="arindas", existing_status="paid")
        monkeypatch.setenv("KIMFAM_INTERNAL_KEY", "test-internal-key")
        from fastapi.testclient import TestClient as _TC
        r = _TC(app).post("/api/klafam/contributions/record-for",
                          headers={"X-Internal-Key": "test-internal-key"},
                          json={"cycle_id": 1, "member_slug": "priscilla"})
        assert r.status_code == 409

    def test_wrong_internal_key_is_unauthenticated(self, monkeypatch):
        self._stub_db(monkeypatch, bene_slug="arindas")
        monkeypatch.setenv("KIMFAM_INTERNAL_KEY", "test-internal-key")
        from fastapi.testclient import TestClient as _TC
        r = _TC(app).post("/api/klafam/contributions/record-for",
                          headers={"X-Internal-Key": "nope"},
                          json={"cycle_id": 1, "member_slug": "priscilla"})
        assert r.status_code == 401


class TestAskClaudeFailureIsVisible:
    """_ask_claude used to swallow CLI errors and return "": a revoked token blanked every
    AI feature for two days with nothing logged. Failures are now recorded and explained."""

    def _run(self, monkeypatch, rc, out="", err=""):
        import subprocess, main as _m
        class R:  # minimal CompletedProcess
            returncode, stdout, stderr = rc, out, err
        monkeypatch.setattr(subprocess, "run", lambda *a, **k: R())
        return _m

    def test_revoked_token_is_recorded_with_restart_hint(self, monkeypatch):
        m = self._run(monkeypatch, 1, err="API Error: 401 OAuth access token has been revoked")
        assert m._ask_claude("hi") == ""
        assert m.ai_unavailable_reason() == "token rejected"
        assert "restart kimfamhub" in m._AI_HEALTH["last_error"]

    def test_success_clears_the_failure(self, monkeypatch):
        m = self._run(monkeypatch, 1, err="boom")
        m._ask_claude("hi")
        m = self._run(monkeypatch, 0, out="agenda; items")
        assert m._ask_claude("hi") == "agenda; items"
        assert m.ai_unavailable_reason() == ""

    def test_empty_stdout_with_rc0_is_a_failure(self, monkeypatch):
        m = self._run(monkeypatch, 0, out="   ")
        assert m._ask_claude("hi") == ""
        assert m.ai_unavailable_reason() == "AI service error"


class TestAskPromptFit:
    """prompt[:100000] cut the member's question (the last block) first once a prompt grew
    past the limit. fit_prompt trims the middle; the question is also at the top."""

    def test_short_prompt_untouched(self):
        from ask_agent import fit_prompt
        assert fit_prompt("abc", 100) == "abc"

    def test_long_prompt_keeps_head_and_the_question_at_the_end(self):
        from ask_agent import fit_prompt
        p = "HEAD-QUESTION " + "x" * 300000 + " MEMBER QUESTION: what did we decide?"
        out = fit_prompt(p, 100000)
        assert len(out) <= 100000
        assert out.startswith("HEAD-QUESTION")
        assert out.endswith("MEMBER QUESTION: what did we decide?")
        assert "context trimmed" in out

    def test_question_is_at_the_top_of_the_template(self):
        from ask_agent import _SYNTH_PROMPT_TEMPLATE as t
        assert t.index("{question}") < t.index("{app_guide}")


class TestAskRagRetrieval:
    """Every indexed chunk is tagged doc_type='document', so the old where={'doc_type':
    'minutes'} filter matched nothing and meeting/constitution questions got ZERO documents.
    Category now comes from the source folder; a named meeting pulls its own minutes."""

    class _FakeCollection:
        def __init__(self, items):  # items: [(source, text)]
            self.items = items
        def query(self, query_embeddings, n_results, include):
            its = self.items[:n_results]
            return {"documents": [[t for _, t in its]],
                    "metadatas": [[{"source": s, "doc_type": "document", "chunk_index": i} for i, (s, _) in enumerate(its)]],
                    "distances": [[0.2] * len(its)]}
        def get(self, include, limit):
            return {"documents": [t for _, t in self.items],
                    "metadatas": [{"source": s, "doc_type": "document", "chunk_index": i} for i, (s, _) in enumerate(self.items)]}

    def _setup(self, monkeypatch, items, meetings=()):
        import ask_agent as a, db as _db
        monkeypatch.setattr(a, "_get_collection", lambda: self._FakeCollection(items))
        monkeypatch.setattr(a, "_embed_query", lambda t: (0.0,))
        monkeypatch.setattr(a, "_cache_get", lambda k: None)
        monkeypatch.setattr(a, "_cache_set", lambda k, v: None)
        monkeypatch.setattr(_db, "query", lambda sql, params=None: list(meetings))
        return a

    def test_minutes_filter_uses_the_folder_not_the_tag(self, monkeypatch):
        a = self._setup(monkeypatch, [("projects/x.docx", "project text"),
                                      ("minutes/KimFam (2026)/M_July_12_2026.docx", "minutes text")])
        out = a.rag_tool("what did we decide", "minutes")
        assert "minutes text" in out and "project text" not in out

    def test_filter_with_no_match_falls_back_instead_of_empty(self, monkeypatch):
        a = self._setup(monkeypatch, [("projects/x.docx", "project text")])
        assert "project text" in a.rag_tool("anything", "receipt")

    def test_named_meeting_pulls_its_own_minutes_first(self, monkeypatch):
        from datetime import date
        a = self._setup(monkeypatch,
                        [("minutes/KimFam (2024)/M_June_9_2024.docx", "old 2024 text"),
                         ("minutes/KimFam (2026)/M_June_7_2026.docx", "kim eight text")],
                        meetings=[{"ref": "KIM 008/2026", "date": date(2026, 6, 7)}])
        out = a.rag_tool("What happened at KIM 008?", "minutes")
        assert out.index("kim eight text") < out.index("old 2024 text")


class TestActionHistory:
    """Action updates are dated in the DB; the list used to send only the text."""

    def test_history_newest_first_with_date_and_author(self, monkeypatch):
        import db as _db
        from datetime import datetime, timezone
        rows = [{"id": 2, "created_at": datetime(2026, 9, 27, 16, 2, tzinfo=timezone.utc), "author": "Solomon",
                 "type": "comment", "text": "later", "old_value": None, "new_value": None,
                 "media_url": None, "media_name": None},
                {"id": 1, "created_at": datetime(2026, 8, 16, 16, 52, tzinfo=timezone.utc), "author": "Hillary",
                 "type": "status_change", "text": "earlier", "old_value": "open", "new_value": "in_progress",
                 "media_url": None, "media_name": None}]
        def fake_query(sql, params=None):
            return [{"id": 7}] if "FROM actions WHERE ref" in sql else rows
        monkeypatch.setattr(_db, "query", fake_query)
        from fastapi.testclient import TestClient as _TC
        r = _TC(app).get("/api/actions/history", params={"ref": "KIM/13/26-8"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d[0]["at"].startswith("2026-09-27") and d[0]["author"] == "Solomon"
        assert d[1]["type"] == "status_change" and d[1]["new_value"] == "in_progress"

    def test_history_unknown_action_is_404(self, monkeypatch):
        import db as _db
        monkeypatch.setattr(_db, "query", lambda sql, params=None: [])
        from fastapi.testclient import TestClient as _TC
        assert _TC(app).get("/api/actions/history", params={"ref": "KIM/99/99-9"}).status_code == 404


class TestLivestockEngine:
    """ADR-029: goats on the sheep engine. Goats are individually owned, so counts, checks and
    money are per owner; the club never shows goat money as its own."""

    EV = [
        {"event_type": "opening", "count": 5, "owner": "Alex"},
        {"event_type": "opening", "count": 2, "owner": "Viola"},
        {"event_type": "birth", "count": 1, "owner": "Viola"},
        {"event_type": "sale", "count": 1, "owner": "Alex", "amount_ugx": 250000},
    ]

    def test_by_owner_counts_and_money(self):
        import livestock as ls
        b = ls.compute_by_owner(self.EV)
        assert b["Alex"]["alive"] == 4 and b["Alex"]["sales_ugx"] == 250000
        assert b["Viola"]["alive"] == 3 and b["Viola"]["births"] == 1

    def test_second_opening_for_same_owner_is_rejected(self):
        import livestock as ls
        ok, err = ls.validate_write("goats", "opening", 6, None, "Alex", self.EV)
        assert not ok and "already has an opening count" in err

    def test_opening_needs_an_owner(self):
        import livestock as ls
        ok, err = ls.validate_write("goats", "opening", 3, None, None, self.EV)
        assert not ok and "owner" in err

    def test_death_cannot_exceed_that_owners_count(self):
        import livestock as ls
        ok, err = ls.validate_write("goats", "death", 3, None, "Viola", self.EV)   # herd has 7, Viola has 3
        assert ok
        ok, err = ls.validate_write("goats", "death", 4, None, "Viola", self.EV)
        assert not ok and "Viola has only 3" in err

    def test_owner_must_be_a_goat_owner(self):
        import livestock as ls
        ok, err = ls.validate_write("goats", "birth", 1, None, "Solomon", self.EV)
        assert not ok and "owner" in err

    def test_goats_mortality_alert_uses_goat_threshold_and_noun(self):
        import livestock as ls, datetime as dt
        today = dt.date(2026, 10, 15)                      # outside the dry season
        deaths = [{"event_type": "death", "event_date": "2026-10-01", "count": 3, "cause": "unknown"}]
        assert ls.compute_alerts(deaths, ls.config("goats"), today) == []        # 3 < 4 for ~55 head
        a = ls.compute_alerts(deaths + [dict(deaths[0], count=1)], ls.config("goats"), today)
        assert a and "goat deaths" in a[0]["text"]

    def test_who_can_record(self):
        import livestock as ls
        merab, solomon = {"sub": "Merab", "role": "member"}, {"sub": "Solomon", "role": "member"}
        alex, admin = {"sub": "Alex", "role": "member"}, {"sub": "Israel", "role": "admin"}
        assert ls.can_write("goats", merab) and not ls.can_write("sheep", merab)
        assert ls.can_write("goats", solomon) and ls.can_write("sheep", solomon)
        assert not ls.can_write("goats", alex)
        assert ls.can_write("goats", admin) and ls.can_write("sheep", admin)
        assert not ls.can_write("cows", admin)

    def test_delete_is_soft_and_scoped_to_the_project(self, monkeypatch):
        import livestock as ls, db as _db
        seen = []
        monkeypatch.setattr(_db, "execute", lambda sql, params=None: seen.append((sql, params)) or (9,))
        assert ls.soft_delete("goats", "event", 9, "Merab") == 9
        sql, params = seen[0]
        assert sql.startswith("UPDATE sheep_events SET deleted_at=now()") and "project_id=%s" in sql
        assert params == ("Merab", 9, "goats")

    def test_goats_write_route_gate_and_insert(self, monkeypatch):
        import livestock as ls
        monkeypatch.setattr(ls, "ready", lambda: True)
        monkeypatch.setattr(ls, "events", lambda pid: [])
        got = {}
        monkeypatch.setattr(ls, "insert_event", lambda pid, b, who, src=None: got.update(pid=pid, owner=b.owner, who=who) or 1)
        body = {"event_type": "opening", "event_date": "2026-09-28", "count": 4, "owner": "Alex"}
        assert TestKlaFamRecordFor._client_as("Alex").post("/api/projects/goats/livestock/event", json=body).status_code == 403
        r = TestKlaFamRecordFor._client_as("Merab").post("/api/projects/goats/livestock/event", json=body)
        assert r.status_code == 200, r.text
        assert got == {"pid": "goats", "owner": "Alex", "who": "Merab"}
        assert TestKlaFamRecordFor._client_as("Merab").post("/api/projects/sheep/event",
            json={"event_type": "birth", "event_date": "2026-09-28", "count": 1}).status_code == 403
        assert TestKlaFamRecordFor._client_as("Israel", role="admin").post("/api/projects/cows/livestock/event",
            json=body).status_code == 404


class TestLivestockWhatsApp:
    """ADR-030: the WhatsApp agent reports with the internal key + reported_by. Same recorder
    rules as a login; replays are deduplicated; undo only removes the reporter's own entries."""

    BODY = {"event_type": "death", "event_date": "2026-09-28", "count": 1, "owner": "Alex",
            "cause": "diarrhoea", "reported_by": "Israel", "source_ref": "wa:ABC:0"}

    def _setup(self, monkeypatch, existing=None, events=None, row=None):
        import livestock as ls
        monkeypatch.setenv("KIMFAM_INTERNAL_KEY", "k")
        monkeypatch.setattr(ls, "ready", lambda: True)
        monkeypatch.setattr(ls, "find_by_source", lambda pid, kind, src: existing)
        monkeypatch.setattr(ls, "events", lambda pid: events if events is not None else
                            [{"id": 1, "event_type": "opening", "count": 5, "owner": "Alex"}])
        monkeypatch.setattr(ls, "row", lambda pid, kind, rid: row)
        got = {}
        monkeypatch.setattr(ls, "insert_event", lambda pid, b, who, src=None: got.update(who=who, src=src) or 42)
        monkeypatch.setattr(ls, "soft_delete", lambda pid, kind, rid, who: got.update(deleted=rid, by=who) or rid)
        from fastapi.testclient import TestClient as _TC
        return _TC(app), got

    def test_recorder_via_whatsapp_is_stamped_and_keeps_source_ref(self, monkeypatch):
        c, got = self._setup(monkeypatch)
        r = c.post("/api/projects/goats/livestock/event", json=self.BODY, headers={"X-Internal-Key": "k"})
        assert r.status_code == 200, r.text
        assert got == {"who": "Dad (Israel) via WhatsApp", "src": "wa:ABC:0"}

    def test_non_recorder_via_whatsapp_is_refused(self, monkeypatch):
        c, _ = self._setup(monkeypatch)
        r = c.post("/api/projects/goats/livestock/event", json=dict(self.BODY, reported_by="Alex"),
                   headers={"X-Internal-Key": "k"})
        assert r.status_code == 403

    def test_reported_by_is_ignored_without_the_internal_key(self, monkeypatch):
        c, _ = self._setup(monkeypatch)
        assert c.post("/api/projects/goats/livestock/event", json=self.BODY).status_code == 401
        assert c.post("/api/projects/goats/livestock/event", json=self.BODY,
                      headers={"X-Internal-Key": "wrong"}).status_code == 401

    def test_replayed_message_is_not_recorded_twice(self, monkeypatch):
        c, got = self._setup(monkeypatch, existing=7, events=[])   # would fail validation if re-validated
        r = c.post("/api/projects/goats/livestock/event", json=self.BODY, headers={"X-Internal-Key": "k"})
        assert r.status_code == 200 and r.json() == {"ok": True, "id": 7, "duplicate": True}
        assert "who" not in got

    def test_undo_only_removes_the_reporters_own_whatsapp_entry(self, monkeypatch):
        c, got = self._setup(monkeypatch, row={"id": 9, "created_by": "Solomon"})
        r = c.delete("/api/projects/goats/livestock/event/9", params={"reported_by": "Israel"},
                     headers={"X-Internal-Key": "k"})
        assert r.status_code == 404 and "deleted" not in got

    def test_undo_that_would_go_negative_is_refused(self, monkeypatch):
        evs = [{"id": 1, "event_type": "opening", "count": 2, "owner": "Alex"},
               {"id": 2, "event_type": "death", "count": 2, "owner": "Alex"}]
        c, got = self._setup(monkeypatch, events=evs, row={"id": 1, "created_by": "Dad (Israel) via WhatsApp"})
        r = c.delete("/api/projects/goats/livestock/event/1", params={"reported_by": "Israel"},
                     headers={"X-Internal-Key": "k"})
        assert r.status_code == 409 and "Alex" in r.json()["detail"] and "deleted" not in got


class TestKlaFamWindow:
    """ADR-031: two rolling cycles. The previous cycle stays open for late payers until the 14th
    of the current cycle's month. Swept over whole years (the 2026-09-03 regression slipped
    through because only the reporting day was tried)."""

    def test_the_real_case_30_sep_2026(self):
        from klafam_window import cycle_window
        from datetime import date
        assert cycle_window(date(2026, 9, 30)) == ((2026, 10), (2026, 9))   # Oct current, Sep still open

    def test_boundaries(self):
        from klafam_window import cycle_window
        from datetime import date
        assert cycle_window(date(2026, 9, 27)) == ((2026, 9), None)
        assert cycle_window(date(2026, 9, 28)) == ((2026, 10), (2026, 9))
        assert cycle_window(date(2026, 10, 13)) == ((2026, 10), (2026, 9))
        assert cycle_window(date(2026, 10, 14)) == ((2026, 10), None)        # closes on the 14th
        assert cycle_window(date(2026, 12, 30)) == ((2027, 1), (2026, 12))   # year rollover
        assert cycle_window(date(2027, 1, 14)) == ((2027, 1), None)

    def test_every_day_of_two_years_is_consistent(self):
        from klafam_window import cycle_window
        from datetime import date, timedelta
        d = date(2026, 1, 1)
        while d <= date(2027, 12, 31):
            (cy, cm), prev = cycle_window(d)
            due = date(cy - 1, 12, 28) if cm == 1 else date(cy, cm - 1, 28)
            assert d >= due - timedelta(days=31) and d < date(cy + (cm // 12), cm % 12 + 1, 28), d  # within its cycle
            assert 1 <= cm <= 12
            if prev is not None:
                py, pm = prev
                assert (py * 12 + pm) == (cy * 12 + cm) - 1, d                # exactly the month before
                assert d < date(cy, cm, 14), d                                # never after the 14th
            else:
                assert d >= date(cy, cm, 14), d                               # closed => on/after the 14th
            d += timedelta(days=1)

    def test_overview_returns_previous_only_while_open(self, monkeypatch):
        import db as _db, main as _m
        from datetime import date as _date
        class D(_date):
            @classmethod
            def today(cls): return cls._today
        rows = {(2026, 9): 72, (2026, 10): 73}
        def fake_query(sql, params=None):
            s = " ".join(sql.split())
            if "information_schema" in s: return [{"exists": 1}]
            if "FROM klafam_cycles WHERE year=%s AND month=%s" in s and s.startswith("SELECT id"):
                return [{"id": rows[tuple(params)]}] if tuple(params) in rows else []
            return []
        monkeypatch.setattr(_db, "query", fake_query)
        monkeypatch.setattr(_m, "_klafam_cycle_detail", lambda cid: {"id": cid})
        monkeypatch.setattr(_m, "_klafam_member_stats", lambda: [])
        import datetime as _dt
        open_prev = {"id": 72, "contributions": [{"is_active": True, "status": "pending"}]}
        for today, want_prev in ((_date(2026, 9, 30), 72), (_date(2026, 10, 14), None)):
            D._today = today
            monkeypatch.setattr(_dt, "date", D)
            monkeypatch.setattr(_m, "_klafam_cycle_detail", lambda cid: open_prev if cid == 72 else {"id": cid, "contributions": []})
            out = _m.klafam_overview(None)
            assert out["current_cycle"]["id"] == 73
            assert (out["previous_cycle"] or {}).get("id") == want_prev
        # fully paid (inactive historical members ignored): closes at once, even before the 14th
        D._today = _date(2026, 9, 30)
        monkeypatch.setattr(_dt, "date", D)
        paid = {"id": 72, "contributions": [{"is_active": True, "status": "paid"},
                                            {"is_active": True, "status": "offset"},
                                            {"is_active": False, "status": "pending"}]}
        monkeypatch.setattr(_m, "_klafam_cycle_detail", lambda cid: paid if cid == 72 else {"id": cid, "contributions": []})
        assert _m.klafam_overview(None)["previous_cycle"] is None


class TestLedgerParity:
    """ADR-032: the ledger computes the AppSheet's Financial Statement from its rows. Synthetic data
    (the repo is public): every figure below is worked out by hand."""

    @staticmethod
    def _snap(**over):
        snap = {
            "product descriptions": [
                ["product id", "product description", "UOM", "U/COST PRICE", "U/SELL  PRICE", "QTY AVAILABLE OVERALL", "AVAILABLE STOCK", "EXPECTED SALES"],
                ["p1", "eggs", "pc", 0, 400, 100, 40000, 40000],        # eggs: valued at SELL
                ["p2", "hens", "pc", 10000, 30000, 7, 70000, 210000],   # 10 stocked - 2 sold - 1 lost
            ],
            "stock details starting may 2024": [
                ["purchase date", "product id", "U/COST PRICE", "QTY stocked", "Total purchase cost", "purchased from"],
                [45000.5, "p1", 0, 130, 0, ""],
                [45001, "p2", 10000, 10, 100000, "Farm A"],
            ],
            "sales": [
                ["Date", "product id", "Quantity sold", "unit selling price", "total  amount sold", "Name of buyer", "type of sale"],
                [45010, "p1", 30, 400, 12000, "x", "Cash"],
                [45011, "p2", 2, 30000, 60000, "y", "Cash"],
            ],
            "used or spoilt items not sold": [
                ["Date", "product id", "usage type", "reason for usage", "Quantity used or spoilt", "total  amount used or spoilt"],
                [45012, "p2", "Damaged", "died", 1, 10000],
            ],
            "company expenses": [
                ["Date", "Expense Item", "Beneficiary", "Quantity", "Unit Price", "Total Cost", "others (Explain)", "Expense Type"],
                [45002, "Feed", "s", 1, 30000, "30,000", "", "Opex"],
                [45003, "Coop", "s", 1, 200000, 200000, "", "Capex"],
            ],
            "Financial Statement": [
                ["product Category", "Metric", "value"],
                ["c", "sales", 72000], ["c", "Spoilt Goods (Cash Loss)", 10000],
                ["c", "Available Stock (Cost)", 110000], ["c", "Expected Sales", 250000],
                ["c", "Operating Expenses (OPEX)", 30000], ["c", "Capital Expenses (CapEx)", 200000],
                ["c", "Depreciation (per year)", 20000], ["c", "Gross Position", 32000],
                ["c", "Net Position (with CapEx)", -168000], ["c", "Net Position (with Depreciation)", 12000],
            ],
        }
        snap.update(over)
        return snap

    def test_parity_on_synthetic_sheet(self):
        import ledger
        ok, lines = ledger.parity(self._snap())
        assert ok, "\n".join(lines)

    def test_a_wrong_sheet_figure_is_a_difference(self):
        import ledger
        bad = self._snap()
        bad["Financial Statement"][1][2] = 72001
        ok, lines = ledger.parity(bad)
        assert not ok and any("DIFF" in l for l in lines)

    def test_eggs_are_valued_at_sell_price_others_at_cost(self):
        import ledger
        st = ledger.statement(ledger.parse_snapshot(self._snap()))
        assert st["per_product"]["p1"]["available_stock"] == 100 * 400
        assert st["per_product"]["p2"]["available_stock"] == 7 * 10000
        assert st["per_product"]["p2"]["expected_sales"] == 7 * 30000

    def test_egg_production_is_not_a_purchase(self):
        import ledger
        kinds = {r["product_id"]: r["kind"] for r in ledger.parse_snapshot(self._snap())["stock"]}
        assert kinds == {"p1": "production", "p2": "purchase"}

    def test_dates_come_from_serials_not_strings(self):
        import ledger, datetime
        assert ledger.serial_date(45460) == datetime.date(2024, 6, 17)
        assert ledger.serial_date(45460.99) == datetime.date(2024, 6, 17)
        assert ledger.serial_date("08/06/2026") is None
        bad = self._snap()
        bad["sales"][1][0] = "08/06/2026"     # a formatted string must stop the import, never guess
        with pytest.raises(ValueError):
            ledger.parse_snapshot(bad)

    def test_numbers_in_mixed_formats(self):
        import ledger
        assert [ledger.to_int(v) for v in ("1,376,800", "  -   ", "", None, 12.6, "12")] == [1376800, 0, 0, 0, 13, 12]

    def test_unknown_expense_type_stops_the_import(self):
        import ledger
        bad = self._snap()
        bad["company expenses"][1][7] = "Loan"
        with pytest.raises(ValueError):
            ledger.parse_snapshot(bad)

    def test_source_refs_are_unique_and_carry_the_snapshot_hash(self):
        import ledger
        p = ledger.parse_snapshot(self._snap())
        refs = [r["source_ref"] for k in ("products", "stock", "sales", "losses", "expenses") for r in p[k]]
        assert len(refs) == len(set(refs)) and all(r.startswith("appsheet:" + p["hash"] + ":") for r in refs)

    # ── read models (ADR-032 decision 9) ─────────────────────────────────────────────────────
    def test_expense_category_names_what_it_is_for(self):
        import ledger
        c = ledger.expense_category
        assert c("Transport for chicken") == "Transport"
        assert c("Medicine for chicken") == "Medicine & Vet"
        assert c("Layer mash") == "Feed & Nutrition"
        assert c("Chicken") == "Birds / Stock" and c("hens") == "Birds / Stock"
        assert c("Chicken mesh") == "Equipment & Supplies"      # a thing for chickens, not chickens

    def test_projects_card_matches_the_sheet_format(self):
        import ledger
        card = ledger.projects_card(ledger.parse_snapshot(self._snap()))
        assert card["sales"]["value"] == "72,000"
        assert card["Net Position (with CapEx)"]["value"] == "-168,000"
        assert list(card) == [lab for lab, _k, _d in ledger.STATEMENT_LABELS]   # the card keys the UI reads

    def test_chicken_data_has_the_shape_consumers_read(self):
        import ledger
        d = ledger.chicken_data(ledger.parse_snapshot(self._snap()))
        assert set(d) == {"products", "sales_by_product", "monthly_egg_sales", "deaths_detail", "batches",
                          "financials_raw", "opex_breakdown", "monthly_spend", "expense_timeline"}
        assert d["products"]["p2"]["available"] == 7 and d["products"]["p2"]["deaths_val"] == 10000
        assert d["financials_raw"]["operating expenses (opex)"] == 30000
        assert d["opex_breakdown"] == {"Feed & Nutrition": 30000}
        assert [b["pid"] for b in d["batches"]] == ["p2"]          # the egg production row is not a batch
        assert d["deaths_detail"] == [] or all(x["product"] for x in d["deaths_detail"])

    def test_ledger_reads_flag_is_off_by_default(self, monkeypatch):
        import main as _m
        monkeypatch.delenv("LEDGER_READS", raising=False)
        assert _m._ledger_reads("chicken") is False
        monkeypatch.setenv("LEDGER_READS", "dairy, chicken")
        assert _m._ledger_reads("chicken") is True and _m._ledger_reads("goats") is False

    # ── native entry + reconciliation (ADR-032) ───────────────────────────────────────────────
    TODAY = __import__("datetime").date(2026, 10, 1)
    PAYERS = ["Farm cash (Solomon)", "Club", "Israel", "Unknown (check)"]
    PRODS = {"p1": {"sell_price": 400, "cost_price": 0}, "p2": {"sell_price": 30000, "cost_price": 10000}}

    def test_expense_needs_a_payer_and_a_sane_date(self):
        import ledger
        ok = {"date": "2026-09-30", "item": "Layer mash", "qty": 2, "unit_price": 80000, "paid_by": "Club"}
        row = ledger.validate_expense(ok, self.TODAY, self.PAYERS, self.PRODS)
        assert row["total"] == 160000 and row["kind"] == "opex" and row["stock"] is None
        for bad, why in (({**ok, "paid_by": ""}, "who paid"), ({**ok, "paid_by": "Nobody"}, "payer"),
                         ({**ok, "date": "2026-10-02"}, "future"), ({**ok, "date": "2020-01-01"}, "before"),
                         ({**ok, "date": "30/09/2026"}, "date"), ({**ok, "item": " "}, "bought"),
                         ({**ok, "unit_price": 0}, "Amount"), ({**ok, "kind": "loan"}, "opex")):
            with pytest.raises(ValueError, match="(?i)" + why):
                ledger.validate_expense(bad, self.TODAY, self.PAYERS, self.PRODS)

    def test_bird_purchase_is_one_entry_with_two_effects(self):
        import ledger
        row = ledger.validate_expense({"date": "2026-09-30", "item": "Chicken", "total": 1300000, "paid_by": "Israel",
                                       "product_id": "p2", "stock_qty": 100}, self.TODAY, self.PAYERS, self.PRODS)
        assert row["stock"]["qty"] == 100 and row["stock"]["total_cost"] == 1300000 and row["stock"]["unit_cost"] == 13000
        assert row["stock"]["paid_by"] == "Israel" and row["stock"]["kind"] == "purchase"
        with pytest.raises(ValueError):
            ledger.validate_expense({"date": "2026-09-30", "item": "Chicken", "total": 5, "paid_by": "Club", "product_id": "zz"},
                                    self.TODAY, self.PAYERS, self.PRODS)

    def test_sale_loss_stock_validation(self):
        import ledger
        s = ledger.validate_sale({"date": "2026-09-30", "product_id": "p1", "qty": 30}, self.TODAY, self.PRODS)
        assert s["unit_price"] == 400 and s["total"] == 12000 and s["payment"] == "Cash"   # price defaults from the product
        with pytest.raises(ValueError):
            ledger.validate_sale({"date": "2026-09-30", "product_id": "p1", "qty": 0}, self.TODAY, self.PRODS)
        l = ledger.validate_loss({"date": "2026-09-30", "product_id": "p2", "qty": 2, "kind": "damaged", "reason": "predator"}, self.TODAY, self.PRODS)
        assert l["kind"] == "Damaged" and l["total"] == 20000                                # qty x cost by default
        with pytest.raises(ValueError):
            ledger.validate_loss({"date": "2026-09-30", "product_id": "p2", "qty": 2, "kind": "Lost", "reason": "x"}, self.TODAY, self.PRODS)
        with pytest.raises(ValueError):
            ledger.validate_loss({"date": "2026-09-30", "product_id": "p2", "qty": 2, "kind": "Damaged", "reason": ""}, self.TODAY, self.PRODS)
        eggs = ledger.validate_stock({"date": "2026-09-30", "product_id": "p1", "qty": 300}, self.TODAY, self.PRODS, self.PAYERS)
        assert eggs["kind"] == "production" and eggs["total_cost"] == 0 and eggs["paid_by"] is None
        with pytest.raises(ValueError, match="(?i)who paid"):
            ledger.validate_stock({"date": "2026-09-30", "product_id": "p2", "qty": 5, "kind": "purchase", "total": 50000},
                                  self.TODAY, self.PRODS, self.PAYERS)

    def _recon_rows(self):
        import datetime
        d = datetime.date
        return {"products": [], "sales": [{"total": 1000, "qty": 1, "product_id": "p1", "sale_date": d(2026, 1, 1)}],
                "losses": [],
                "stock": [{"id": 1, "kind": "purchase", "total_cost": 100, "qty": 1, "unit_cost": 100, "event_date": d(2026, 1, 1), "product_id": "p2"},
                          {"id": 2, "kind": "purchase", "total_cost": 200, "qty": 2, "unit_cost": 100, "event_date": d(2026, 2, 1), "product_id": "p2"},
                          {"id": 3, "kind": "purchase", "total_cost": 900, "qty": 9, "unit_cost": 100, "event_date": d(2026, 3, 1), "product_id": "p2"}],
                "expenses": [{"id": 1, "item": "Chicken", "total": 100, "kind": "opex", "qty": 1, "unit_price": 100, "expense_date": d(2026, 1, 3), "paid_by": None, "source": "appsheet_import"},
                             {"id": 2, "item": "Chicken", "total": 200, "kind": "opex", "qty": 2, "unit_price": 100, "expense_date": d(2026, 2, 1), "paid_by": None, "source": "appsheet_import"},
                             {"id": 3, "item": "Chicken", "total": 500, "kind": "opex", "qty": 5, "unit_price": 100, "expense_date": d(2026, 4, 1), "paid_by": "Club", "source": "app", "receipt_url": None},
                             {"id": 4, "item": "Equipment", "total": 400, "kind": "capex", "qty": 1, "unit_price": 400, "expense_date": d(2026, 4, 2), "paid_by": "Club", "source": "app", "receipt_url": "/r"}]}

    def test_bird_open_items_match_by_amount_then_date(self):
        import ledger
        items = ledger.bird_open_items(self._recon_rows())
        kinds = sorted(i["key"].split(":")[1] for i in items)
        assert kinds == ["expense_only", "stock_only"]       # 100 matched 2 days apart and 200 exact: both fine
        by = {i["key"].split(":")[1]: i for i in items}
        assert by["expense_only"]["amount"] == 500 and by["stock_only"]["amount"] == 900

    def test_reconciliation_keeps_two_accounts_and_explains_items(self):
        import ledger, datetime
        d = datetime.date
        tre = [{"id": 1, "txn_date": d(2026, 1, 1), "description": "Free range chicken capital", "amount_ugx": 5000, "category": "project_investment", "recorded_by": "system_import"},
               {"id": 2, "txn_date": d(2026, 1, 2), "description": "Solomon June pay", "amount_ugx": 200, "category": "staff", "recorded_by": "Hellen"},
               {"id": 3, "txn_date": d(2026, 1, 3), "description": "Refund to Dad for feeds", "amount_ugx": 700, "category": "project_investment", "recorded_by": "Hellen"}]
        r = ledger.build_reconciliation(self._recon_rows(), tre, [], [])
        fb = r["farm_box"]
        assert fb["in"] == {"capital": 5000, "sales": 1000, "total": 6000}    # pay and refund are NOT farm money in
        assert fb["out"]["total"] == 100 + 200 + 500 + 400 and fb["gap"] == fb["out"]["total"] - 6000
        keys = {i["key"] for i in r["open_items"]}
        assert {"treasury:3", "preledger:unattributed", "receipts:missing", "gap"} <= keys and "treasury:2" not in keys
        # a linked refund and an explaining note both close an item
        r2 = ledger.build_reconciliation(self._recon_rows(), tre, [{"expenditure_id": 3, "amount": 700}],
                                         [{"item_key": "gap", "body": "covered by Dad", "explained": True, "author": "Hillary", "created_at": d(2026, 2, 1)}])
        done = {i["key"] for i in r2["open_items"] if i["explained"]}
        assert {"treasury:3", "gap"} <= done and r2["open_count"] < r["open_count"]
        assert [n["author"] for i in r2["open_items"] if i["key"] == "gap" for n in i["notes"]] == ["Hillary"]


class TestProjectionModel:
    """ADR-033: the proposal sheet parsed into a plan, and actuals scored against it. A small synthetic
    sheet in the same layout as the real one (the repo is public: no real figures here)."""

    @staticmethod
    def _sheet():
        H = ["", "1. Sales", "1st Month", "2nd Month", "3rd Month", "4th Month", "5th Month", "6th", "7th", "7th"]
        return [
            ["", "PROJECTIONS"],
            ["", "", 45474, 45505],
            H,
            ["Phase 1( 100 chicken) ", "Eggs", "", "", "", "", 1500, 1800, 1800, ""],
            ["", "Chicken", "", "", "", "", "", "", "", 80],
            ["Phase 2 (100 chicken)", "Eggs", "", "", "", "", "", 1800, "", ""],
            ["", "Chicken"],
            ["", "Total"],
            ["", "2. Revenue"] + H[2:],
            ["Phase 1( 100 chicken) ", "Eggs", 0, 0, 0, 0, 600000, 720000, 720000, 0],
            ["", "Chicken", 0, 0, 0, 0, 0, 0, 0, 2400000],
            ["Phase 2 (100 chicken)", "Eggs", 0, 0, 0, 0, 0, 720000, 0, 0],
            ["", "Chicken"],
            ["", "Total"],
            ["", "3. Cost of Sale", "1st Month (100 chicken)", "January", "February"],
            ["", "Chicken", 1300000],
            ["", "Supplementary food", "", 200000, 200000],
            ["", "Total", 1300000, 200000, 200000],
            ["", "4. Other Expences "],
            ["", "Salaries", 100000, 100000, 100000, 100000, 100000, 100000, 100000],
            ["", "Total", 100000, 100000, 100000, 100000, 100000, 100000, 100000],
            ["", "Summary "],
            ["", "Duration", "", "jul-24 to jan-26", "dec-24 to jun-26"],
            ["", "Expenditure so far", "Amount"],
            ["Construction", "Iron sheets", 500000],
            ["", "Sub total", 500000],
            ["", "Total investment", 1000000],
        ]

    def test_parse_phases_months_and_costs(self):
        import projection as P
        m = P.parse_sheet(self._sheet())
        assert m["months"] == 7 and [p["birds"] for p in m["phases"]] == [100, 100]
        p1, p2 = m["phases"]
        assert p1["first_egg_month"] == 5 and p1["start_month"] == 1            # first eggs 4 months after the birds
        assert p2["start_month"] == 6                                          # the Duration row wins where it states one
        assert p1["eggs"] == {"5": 1500, "6": 1800, "7": 1800}
        assert p1["birds_sold"] == {"7": 80} and p1["revenue_birds"] == {"7": 2400000}   # extra column folds into its month
        assert m["cost_of_sale_blocks"]["100"] == {"0": 1300000, "1": 200000, "2": 200000}
        assert m["other_monthly"]["1"] == 100000 and m["investment_total"] == 1000000
        assert m["capital"][0]["items"] == [{"label": "Iron sheets", "amount": 500000}] and m["capital"][0]["total"] == 500000

    def test_monthly_plan_combines_phases(self):
        import projection as P
        plan = P.monthly_plan(P.parse_sheet(self._sheet()))
        assert plan[1]["cos"] == 1300000 and plan[2]["cos"] == 200000
        assert plan[6]["rev_eggs"] == 1440000 and plan[7]["rev_birds"] == 2400000 and plan[7]["birds_sold"] == 80
        assert plan[5]["profit"] == 600000 - 0 - 100000 - 0 or plan[5]["revenue"] == 600000
        assert sum(v["revenue"] for v in plan.values()) == 600000 + 1440000 + 720000 + 2400000

    def test_a_different_layout_is_refused(self):
        import projection as P
        with pytest.raises(ValueError):
            P.parse_sheet([["", "nothing here"]])
        bad = [r for r in self._sheet() if not str(r[1]).startswith("3. Cost")]
        with pytest.raises(ValueError):
            P.parse_sheet(bad)

    def test_month_arithmetic(self):
        import projection as P, datetime
        assert P.month_label(1) == "Jul 2024" and P.month_label(7) == "Jan 2025" and P.month_label(38) == "Aug 2027"
        assert P.month_number(datetime.date(2024, 7, 1)) == 1 and P.month_number(datetime.date(2026, 10, 2)) == 28
        assert P.month_number(datetime.date(2024, 6, 17)) == 0               # before the plan began

    def _rows(self, today_month_spend=0):
        import datetime
        d = datetime.date
        return {
            "products": [{"product_id": "p1", "name": "eggs"}, {"product_id": "p2", "name": "hens"}],
            "stock": [{"product_id": "p2", "event_date": d(2024, 6, 20), "qty": 100, "kind": "purchase", "unit_cost": 13000, "total_cost": 1300000},
                      {"product_id": "p1", "event_date": d(2024, 12, 5), "qty": 1000, "kind": "production", "unit_cost": 0, "total_cost": 0}],
            "sales": [{"product_id": "p1", "sale_date": d(2024, 12, 6), "qty": 900, "total": 360000, "unit_price": 400},
                      {"product_id": "p2", "sale_date": d(2024, 12, 9), "qty": 5, "total": 150000, "unit_price": 30000}],
            "losses": [{"product_id": "p2", "loss_date": d(2024, 11, 1), "qty": 4, "total": 52000, "kind": "Damaged", "reason": "x"}],
            "expenses": [{"item": "Chicken", "expense_date": d(2024, 6, 20), "total": 1300000, "kind": "opex"},
                         {"item": "Layer mash", "expense_date": d(2024, 9, 3), "total": 200000, "kind": "opex"},
                         {"item": "Fuel for fetching water", "expense_date": d(2024, 10, 3), "total": 20000, "kind": "opex"},
                         {"item": "Iron sheets", "expense_date": d(2024, 8, 3), "total": 400000, "kind": "capex"}],
        }

    def test_score_has_two_answers_and_sane_values(self):
        import projection as P, datetime
        model = P.parse_sheet(self._sheet())
        r = P.score(model, self._rows(), [], datetime.date(2024, 12, 15))
        assert r["month_now"] == 6 and r["as_of"] == "Dec 2024"
        assert r["execution"]["birds_bought"] == 100 and r["execution"]["birds_planned_by_now"] == 200 and r["execution"]["pct"] == 50
        assert 0 <= r["score"]["total"] <= 100 and r["score"]["rating"] in ("On track", "Watch", "Behind", "Off plan")
        assert sum(p["weight"] for p in r["score"]["parts"]) == 100
        k = {x["key"]: x for x in r["kpis"]}
        assert k["revenue"]["actual"] == 510000 and k["revenue"]["plan"] <= k["revenue"]["plan_as_written"]
        assert k["cos"]["actual"] == 1500000                                     # birds + feed counted as cost of sale, fuel as other
        assert k["other"]["actual"] == 20000
        assert r["phases"][0]["status"] == "bought" and r["phases"][1]["status"] == "overdue"
        assert r["capital"]["capex_to_date"] == 400000                           # equipment is kept apart from running costs
        assert r["flock"] == {"bought": 100, "died": 4, "survival_pct": 96.0}

    def test_pre_launch_spending_folds_into_month_one(self):
        import projection as P, datetime
        act = P.actual_monthly(self._rows(), [], 6)
        assert act[1]["cos"] == 1300000                                          # the June 2024 birds land in month 1

    def test_club_pay_counts_as_other_expense(self):
        import projection as P, datetime
        tre = [{"id": 1, "txn_date": datetime.date(2024, 10, 5), "description": "Manager pay", "amount_ugx": 300000, "category": "staff", "recorded_by": "x"},
               {"id": 2, "txn_date": datetime.date(2024, 10, 6), "description": "Free range chicken capital", "amount_ugx": 9000000, "category": "project_investment", "recorded_by": "system_import"}]
        act = P.actual_monthly(self._rows(), tre, 6)
        assert act[4]["other"] == 20000 + 300000                                 # pay yes, capital no


class TestLedgerDrill:
    """Ticket #99: every summary card drills down, and every level adds up to the level above it."""

    @staticmethod
    def _rows():
        import datetime
        d = datetime.date
        return {
            "products": [{"product_id": "p1", "name": "eggs", "cost_price": 0, "sell_price": 400, "valuation": "sell"},
                         {"product_id": "p2", "name": "hens", "cost_price": 10000, "sell_price": 30000, "valuation": "cost"}],
            "stock": [{"id": 1, "product_id": "p1", "event_date": d(2025, 1, 5), "qty": 1000, "kind": "production", "unit_cost": 0, "total_cost": 0},
                      {"id": 2, "product_id": "p2", "event_date": d(2025, 1, 2), "qty": 10, "kind": "purchase", "unit_cost": 10000, "total_cost": 100000}],
            "sales": [{"id": 1, "product_id": "p1", "sale_date": d(2025, 1, 6), "qty": 100, "unit_price": 400, "total": 40000, "buyer": "x"},
                      {"id": 2, "product_id": "p1", "sale_date": d(2025, 3, 6), "qty": 50, "unit_price": 400, "total": 20000, "buyer": ""},
                      {"id": 3, "product_id": "p1", "sale_date": d(2026, 3, 9), "qty": 25, "unit_price": 400, "total": 10000, "buyer": ""},
                      {"id": 4, "product_id": "p2", "sale_date": d(2025, 3, 7), "qty": 2, "unit_price": 30000, "total": 60000, "buyer": "y"}],
            "losses": [{"id": 1, "product_id": "p2", "loss_date": d(2025, 2, 1), "qty": 1, "total": 10000, "kind": "Damaged", "reason": "died"}],
            "expenses": [{"id": 1, "item": "Layer mash", "expense_date": d(2025, 1, 9), "total": 80000, "kind": "opex", "qty": 1, "unit_price": 80000},
                         {"id": 2, "item": "Medicine for chicken", "expense_date": d(2025, 2, 9), "total": 5000, "kind": "opex", "qty": 1, "unit_price": 5000},
                         {"id": 3, "item": "Coop", "expense_date": d(2025, 1, 1), "total": 300000, "kind": "capex", "qty": 1, "unit_price": 300000}],
        }

    def test_every_card_total_equals_the_statement(self):
        import ledger
        rows = self._rows()
        st = ledger.statement(rows)
        for card, key in (("sales", "sales"), ("spoilt", "spoilt"), ("opex", "opex"), ("capex", "capex"),
                          ("stock", "available_stock_cost"), ("expected", "expected_sales")):
            d = ledger.drill(rows, card)
            assert d["total"] == st[key] and sum(r["amount"] for r in d["rows"]) == st[key], card

    def test_sales_drill_sums_at_each_level_down_to_the_lines(self):
        import ledger
        rows = self._rows()
        g = ledger.drill(rows, "sales")
        assert [(r["label"], r["amount"]) for r in g["rows"]] == [("Eggs", 70000), ("Hens", 60000)]       # biggest first
        y = ledger.drill(rows, "sales", "Eggs")
        assert y["level"] == "year" and [(r["key"], r["amount"]) for r in y["rows"]] == [("2026", 10000), ("2025", 60000)]
        m = ledger.drill(rows, "sales", "Eggs", 2025)
        assert m["level"] == "month" and [(r["label"], r["amount"]) for r in m["rows"]] == [("March", 20000), ("January", 40000)]
        ln = ledger.drill(rows, "sales", "Eggs", 2025, 1)
        assert ln["level"] == "lines" and ln["total"] == 40000 and ln["lines"][0]["amount"] == 40000
        assert [c["label"] for c in ln["crumbs"]] == ["Total sales", "Eggs", "2025", "January"]

    def test_opex_groups_by_what_it_was_for_not_by_keyword_order(self):
        import ledger
        d = ledger.drill(self._rows(), "opex")
        assert {(r["label"], r["amount"]) for r in d["rows"]} == {("Feed & Nutrition", 80000), ("Medicine & Vet", 5000)}

    def test_stock_drill_shows_quantity_and_the_movements_behind_it(self):
        import ledger
        d = ledger.drill(self._rows(), "stock")
        assert {r["label"]: r["count"] for r in d["rows"]} == {"Eggs": 825, "Hens": 7}
        mv = ledger.drill(self._rows(), "stock", "Hens")
        assert mv["level"] == "movements" and mv["qty_available"] == 7
        assert [l["balance"] for l in mv["lines"]][0] == 7 and mv["lines"][-1]["amount"] == 10        # newest first, running balance

    def test_unknown_card_is_refused(self):
        import ledger
        with pytest.raises(ValueError):
            ledger.drill(self._rows(), "profit")
