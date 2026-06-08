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
        r = client.get("/api/auth/me", headers={"Authorization":"Bearer rubbish"})
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
        assert client.get("/api/family-profiles").status_code == 401

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
        assert client.put("/api/family-profiles/arindas",
                          json={"children": []}).status_code == 401

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
