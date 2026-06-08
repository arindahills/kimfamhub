"""
KimFam Hub -- Playwright frontend smoke tests.
Starts a test uvicorn instance on port 8001 with a temp SQLite DB.
Never touches the production DB.
"""
import os, tempfile, subprocess, time, sqlite3
import bcrypt
import pytest
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:8001"


def _seed_db(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.execute("""CREATE TABLE IF NOT EXISTS members (
        name TEXT PRIMARY KEY, display TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
        password_hash TEXT NOT NULL DEFAULT '__locked__', must_change_password INTEGER NOT NULL DEFAULT 1
    )""")
    members = [
        ("Israel","Israel Kikangi","admin"),("Merab","Merab Kikangi","member"),
        ("Alex","Alex Tuhimbise","member"),("Priscilla","Priscilla Tuhimbise","member"),
        ("Max","Max Turamye","member"),("Janet","Janet Turamye","member"),
        ("Viola","Viola Arunga","member"),("Simon","Simon Arunga","member"),
        ("Solomon","Solomon Ariho","member"),("Hillary","Hillary Arinda","admin"),
        ("Esther","Esther Arinda","member"),("Hellen","Hellen Kofuna","admin"),
        ("Lawi","Lawi Kofuna","member"),
    ]
    for name, display, role in members:
        conn.execute("INSERT OR IGNORE INTO members (name, display, role) VALUES (?,?,?)", (name, display, role))
    for name, pw in [("Hillary","TestPass1"),("Hellen","TestPass2"),("Alex","TestPass3"),("Esther","TestPass4")]:
        h = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
        conn.execute("UPDATE members SET password_hash=?, must_change_password=0 WHERE name=?", (h, name))
    conn.execute("""CREATE TABLE IF NOT EXISTS family_profiles (
        family_id TEXT PRIMARY KEY, family_name TEXT, parents TEXT DEFAULT '[]',
        children TEXT DEFAULT '[]', note TEXT DEFAULT '', updated_at TEXT, updated_by TEXT
    )""")
    conn.execute("INSERT OR IGNORE INTO family_profiles (family_id, family_name, parents, children) VALUES (?,?,?,?)",
        ("kikangis","The Kikangis","[]","[]"))
    conn.execute("""CREATE TABLE IF NOT EXISTS income_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, amount_ugx INTEGER,
        received_from TEXT, collector TEXT, txn_ref TEXT, notes TEXT, recorded_at TEXT
    )""")
    conn.commit()
    conn.close()


@pytest.fixture(scope="module")
def server():
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    db_path = tmp.name
    _seed_db(db_path)

    env = {**os.environ, "KIMFAM_DB_PATH": db_path, "JWT_SECRET": "test-secret-playwright",
           "WASHING_BAY_PIN": "99999", "INTERNAL_API_KEY": "test-key"}
    proc = subprocess.Popen(
        ["/var/www/kimfamhub/venv/bin/uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001"],
        cwd="/var/www/kimfamhub", env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    import urllib.request
    for _ in range(30):
        try:
            urllib.request.urlopen(f"{BASE}/static/manifest.json", timeout=1)
            break
        except Exception:
            time.sleep(0.5)

    yield BASE

    proc.terminate()
    proc.wait()
    os.unlink(db_path)


@pytest.fixture(scope="module")
def _browser(server):
    """One Chromium browser for the whole module."""
    pw = sync_playwright().start()
    browser = pw.chromium.launch(headless=True)
    yield browser
    browser.close()
    pw.stop()


@pytest.fixture(scope="function")
def ctx(_browser):
    """Fresh browser context (empty localStorage) per test."""
    context = _browser.new_context()
    yield context
    context.close()


def _login(page, name="Hillary", pw="TestPass1"):
    page.wait_for_selector("#login-modal", state="visible", timeout=6000)
    page.fill("#login-name", name)
    page.fill("#login-password", pw)
    page.click("button:has-text('Sign In')")
    page.wait_for_selector("#home.active", timeout=6000)


# -- Page Load -------------------------------------------------------------------

class TestPageLoad:
    def test_login_modal_visible_on_load(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        expect(page.locator("#login-modal")).to_be_visible(timeout=6000)
        page.close()

    def test_home_hidden_before_login(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        page.wait_for_selector("#login-modal", state="visible", timeout=6000)
        expect(page.locator("#home")).not_to_be_visible()
        page.close()

    def test_title(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        expect(page).to_have_title("KimFam Hub")
        page.close()


# -- Login Flow ------------------------------------------------------------------

class TestLoginFlow:
    def test_valid_login_shows_home(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        _login(page)
        expect(page.locator("#home")).to_be_visible()
        page.close()

    def test_wrong_password_shows_error(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        page.wait_for_selector("#login-modal", state="visible", timeout=6000)
        page.fill("#login-name", "Hillary")
        page.fill("#login-password", "WrongPass!")
        page.click("button:has-text('Sign In')")
        expect(page.locator("#login-err")).to_contain_text("Incorrect", timeout=4000)
        page.close()

    def test_member_name_in_header_after_login(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        _login(page)
        page.wait_for_selector("#member-badge:not(:empty)", timeout=5000)
        assert "Hillary" in page.locator("#member-badge").inner_text()
        page.close()

    def test_password_toggle_on_login_form(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        page.wait_for_selector("#login-modal", state="visible", timeout=6000)
        pw_input = page.locator("#login-password")
        assert pw_input.get_attribute("type") == "password"
        page.click("#login-modal button[onclick*='login-password']")
        assert pw_input.get_attribute("type") == "text"
        page.close()


# -- Navigation ------------------------------------------------------------------

class TestNavigation:

    @pytest.mark.parametrize("screen_id,nav_label", [
        ("actions", "Action Points"),
        ("finances", "Finances"),
        ("members", "Members"),
        ("projects", "Projects"),
        ("loans", "Loans"),
        ("meetings", "Meetings"),
        ("docs", "Documents"),
        ("ask", "Ask KimFam"),
    ])
    def test_navigate_to_tab(self, server, ctx, screen_id, nav_label):
        page = ctx.new_page()
        page.goto(server)
        _login(page)
        page.click(".hamburger")
        page.wait_for_selector(".drawer.open", timeout=2000)
        page.click(f".nav-item:has-text('{nav_label}')")
        expect(page.locator(f"#{screen_id}")).to_be_visible(timeout=5000)
        page.close()

    def test_show_with_null_el_does_not_crash_nav(self, server, ctx):
        """Calling show(id, label, null) must not crash — the nav-item el param is optional."""
        page = ctx.new_page()
        page.goto(server)
        _login(page)
        # Call show() with null el — tests the null-guard branch without needing live Sheet data
        page.evaluate("show('docs', 'Documents', null)")
        expect(page.locator("#docs")).to_be_visible(timeout=3000)
        # Navigate back home with null el too
        page.evaluate("show('home', 'Home', null)")
        expect(page.locator("#home")).to_be_visible(timeout=3000)
        page.close()

    def test_admin_tab_visible_for_hillary(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        _login(page, "Hillary", "TestPass1")
        expect(page.locator("#admin-nav")).to_be_visible(timeout=3000)
        page.close()

    def test_admin_tab_hidden_for_alex(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        _login(page, "Alex", "TestPass3")
        expect(page.locator("#admin-nav")).to_be_hidden(timeout=3000)
        page.close()

    def test_admin_tab_visible_for_hellen(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        _login(page, "Hellen", "TestPass2")
        expect(page.locator("#admin-nav")).to_be_visible(timeout=3000)
        page.close()


# -- Logout ----------------------------------------------------------------------

class TestLogout:
    def test_logout_shows_login_on_next_tab(self, server, ctx):
        """After logout, any protected nav triggers the login modal."""
        page = ctx.new_page()
        page.goto(server)
        _login(page)
        page.click("text=Sign out")
        # Login modal appears immediately after logout when navigating home
        expect(page.locator("#login-modal")).to_be_visible(timeout=3000)
        # Confirm that trying to navigate to another tab while logged out still shows login
        page.evaluate("show('finances', 'Finances', null)")
        expect(page.locator("#login-modal")).to_be_visible(timeout=3000)
        page.close()


# -- Account Settings ------------------------------------------------------------

class TestAccountSettings:
    def test_settings_modal_opens(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        _login(page)
        page.wait_for_selector("#member-badge:not(:empty)", timeout=5000)
        page.locator("#member-badge span[onclick*='openAccountSettings']").click()
        expect(page.locator("#account-settings-modal")).to_be_visible(timeout=3000)
        page.close()

    def test_settings_shows_member_name(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        _login(page)
        page.wait_for_selector("#member-badge:not(:empty)", timeout=5000)
        page.locator("#member-badge span[onclick*='openAccountSettings']").click()
        page.wait_for_selector("#account-settings-modal", state="visible", timeout=3000)
        assert "Hillary" in page.locator("#settings-member-name").inner_text()
        page.close()

    def test_settings_closes(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        _login(page)
        page.wait_for_selector("#member-badge:not(:empty)", timeout=5000)
        page.locator("#member-badge span[onclick*='openAccountSettings']").click()
        page.wait_for_selector("#account-settings-modal", state="visible", timeout=3000)
        page.locator("#account-settings-modal button:has-text('×')").click()
        expect(page.locator("#account-settings-modal")).to_be_hidden(timeout=2000)
        page.close()

    def test_wrong_old_password_shows_error(self, server, ctx):
        page = ctx.new_page()
        page.goto(server)
        _login(page)
        page.wait_for_selector("#member-badge:not(:empty)", timeout=5000)
        page.locator("#member-badge span[onclick*='openAccountSettings']").click()
        page.wait_for_selector("#account-settings-modal", state="visible", timeout=3000)
        page.fill("#settings-old-pw", "WrongOld!")
        page.fill("#settings-new-pw", "NewPass99")
        page.fill("#settings-confirm-pw", "NewPass99")
        page.locator("#account-settings-modal button[onclick*='saveSettingsPassword']").click()
        expect(page.locator("#settings-pw-err")).to_be_visible(timeout=3000)
        page.close()
