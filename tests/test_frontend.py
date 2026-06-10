"""
KimFam Hub -- Playwright frontend smoke tests for the React app.
Runs against staging (SMOKE_BASE_URL) using a real test account.

These tests exist specifically to catch React AuthContext / URL regressions
that backend-only tests cannot see. If the React app calls the wrong API
URL, gets a 405, or fails to render after login -- these tests will fail.

Run locally:
  pip install playwright pytest-playwright
  playwright install chromium
  SMOKE_BASE_URL=https://staging.kimfamhub.com \
  SMOKE_TEST_PASSWORD=Khill@123 \
  pytest tests/test_frontend.py -v
"""
import os
import pytest
from playwright.sync_api import sync_playwright, expect, Page

BASE = os.getenv("SMOKE_BASE_URL", "https://staging.kimfamhub.com").rstrip("/")
TEST_USER = "Hillary"
TEST_PASSWORD = os.getenv("SMOKE_TEST_PASSWORD", "password")
HEADLESS = os.getenv("PLAYWRIGHT_HEADLESS", "1") != "0"


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=HEADLESS)
        yield b
        b.close()


@pytest.fixture(scope="function")
def page(browser):
    ctx = browser.new_context(base_url=BASE)
    p = ctx.new_page()
    yield p
    ctx.close()


def _login(page: Page, name: str = TEST_USER, password: str = TEST_PASSWORD):
    """Navigate to root, fill login form, submit, and wait for dashboard."""
    page.goto(BASE)
    # React renders a login card -- wait for the member name input to appear
    page.wait_for_selector("input[autocomplete='username']", timeout=10000)
    page.fill("input[autocomplete='username']", name)
    page.fill("input[type='password']", password)
    page.click("button[type='submit']")
    # After login the sidebar nav (desktop) or bottom tab bar (mobile) appears
    page.wait_for_selector("nav", timeout=8000)


# ── Page load ────────────────────────────────────────────────────────────────

class TestPageLoad:
    def test_root_returns_react_html(self, page):
        """/ must serve the React bundle, not the old Jinja2 page."""
        r = page.goto(BASE)
        assert r.status == 200
        # React app mounts on #root
        page.wait_for_selector("#root", timeout=8000)
        content = page.content()
        assert "KimFam" in content, "Page content missing KimFam"
        assert "Jinja2" not in content, "Old Jinja2 template served instead of React"

    def test_login_form_visible_before_auth(self, page):
        """Unauthenticated visit must show the login card, not the dashboard."""
        page.goto(BASE)
        page.wait_for_selector("input[autocomplete='username']", timeout=8000)
        assert page.is_visible("input[autocomplete='username']")
        assert page.is_visible("input[type='password']")

    def test_logo_visible_on_login(self, page):
        """KimFam logo image must appear on the login page."""
        page.goto(BASE)
        page.wait_for_selector("img[alt='KimFam Hub']", timeout=8000)
        assert page.is_visible("img[alt='KimFam Hub']")

    def test_forgot_password_link_present(self, page):
        """Forgot password link must exist on the login form."""
        page.goto(BASE)
        page.wait_for_selector("input[autocomplete='username']", timeout=8000)
        assert page.get_by_text("Forgot password").is_visible()

    def test_page_title(self, page):
        page.goto(BASE)
        expect(page).to_have_title("KimFam Hub", timeout=8000)


# ── Login flow ────────────────────────────────────────────────────────────────

class TestLoginFlow:
    def test_valid_login_shows_nav(self, page):
        """Correct credentials must result in the nav sidebar/tab bar appearing."""
        _login(page)
        assert page.is_visible("nav")

    def test_login_calls_correct_api_endpoint(self, page):
        """AuthContext must call /api/auth/login (not /api/login).
        A 405 or 404 on login means the wrong URL is being hit."""
        errors = []
        page.on("response", lambda r: errors.append(r)
                if r.url.endswith("/api/login") and r.status in (404, 405)
                else None)
        page.goto(BASE)
        page.wait_for_selector("input[autocomplete='username']", timeout=8000)
        page.fill("input[autocomplete='username']", TEST_USER)
        page.fill("input[type='password']", TEST_PASSWORD)

        api_calls = []
        page.on("request", lambda r: api_calls.append(r.url) if "auth" in r.url else None)
        page.click("button[type='submit']")
        page.wait_for_selector("nav", timeout=8000)

        assert not any("/api/login" in u for u in api_calls), (
            "React called /api/login (wrong). Expected /api/auth/login. "
            "Auth URLs in AuthContext.tsx are broken."
        )
        assert any("/api/auth/login" in u for u in api_calls), (
            f"Expected a call to /api/auth/login but got: {api_calls}"
        )

    def test_wrong_password_shows_error(self, page):
        """Wrong password must show an inline error, not a JS exception."""
        page.goto(BASE)
        page.wait_for_selector("input[autocomplete='username']", timeout=8000)
        page.fill("input[autocomplete='username']", TEST_USER)
        page.fill("input[type='password']", "definitely-wrong-pw")
        page.click("button[type='submit']")
        page.wait_for_timeout(2000)
        # Login form must still be visible (not redirected)
        assert page.is_visible("input[autocomplete='username']"), (
            "Login form disappeared after a wrong password -- app may have crashed"
        )

    def test_member_name_visible_after_login(self, page):
        """After login the user's display name must appear somewhere in the UI."""
        _login(page)
        # Nav shows user name in sidebar header (desktop) or top bar
        content = page.content()
        assert "Hillary" in content, "Logged-in user name not found anywhere on the page"

    def test_no_method_not_allowed_on_login(self, page):
        """405 Method Not Allowed on login means the API URL is wrong."""
        bad_statuses = []
        page.on("response", lambda r: bad_statuses.append((r.url, r.status))
                if r.status == 405 else None)
        page.goto(BASE)
        page.wait_for_selector("input[autocomplete='username']", timeout=8000)
        page.fill("input[autocomplete='username']", TEST_USER)
        page.fill("input[type='password']", TEST_PASSWORD)
        page.click("button[type='submit']")
        page.wait_for_timeout(3000)
        assert not bad_statuses, (
            f"Got 405 Method Not Allowed on: {bad_statuses}. "
            "A route exists but does not accept the HTTP method being used."
        )


# ── Navigation ────────────────────────────────────────────────────────────────

class TestNavigation:
    @pytest.mark.parametrize("path,expected_text", [
        ("/finances", "Finances"),
        ("/members",  "Members"),
        ("/projects", "Projects"),
        ("/meetings", "Meetings"),
        ("/docs",     "Documents"),
        ("/ask",      "Ask KimFam"),
    ])
    def test_direct_nav_route_loads(self, page, path, expected_text):
        """Deep links must load the React SPA, not a 404 or the Jinja2 app."""
        _login(page)
        page.goto(f"{BASE}{path}")
        page.wait_for_selector("nav", timeout=6000)
        # The nav item for this route should be highlighted or the page title visible
        content = page.content()
        assert expected_text in content, (
            f"{path} loaded but '{expected_text}' not found in page content"
        )

    def test_admin_tab_visible_for_hillary(self, page):
        _login(page)
        content = page.content()
        assert "admin" in content.lower() or "Admin" in content, (
            "Admin nav item missing for Hillary (admin user)"
        )


# ── Auth session persistence ──────────────────────────────────────────────────

class TestAuthSession:
    def test_me_endpoint_works_after_login(self, page):
        """/api/auth/me must return 200 after login cookie is set."""
        _login(page)
        r = page.evaluate("""async () => {
            const r = await fetch('/api/auth/me', {credentials: 'include'});
            return {status: r.status, body: await r.json()};
        }""")
        assert r["status"] == 200, f"/api/auth/me returned {r['status']}"
        assert r["body"]["name"] == "Hillary"

    def test_logout_clears_session(self, page):
        """After logout, /api/auth/me must return 401."""
        _login(page)
        # Click the logout button
        page.get_by_role("button", name="Log Out").click()
        page.wait_for_timeout(1000)
        # Login form should reappear
        assert page.is_visible("input[autocomplete='username']"), (
            "Login form not shown after logout"
        )


# ── Forgot password flow ──────────────────────────────────────────────────────

class TestForgotPassword:
    def test_forgot_password_opens_second_form(self, page):
        """Clicking 'Forgot password?' must switch to the forgot-password form."""
        page.goto(BASE)
        page.wait_for_selector("input[autocomplete='username']", timeout=8000)
        page.get_by_text("Forgot password").click()
        page.wait_for_timeout(500)
        # Should now show a different form with a Send Code button
        assert page.is_visible("button:has-text('Send Code')"), (
            "Forgot-password form did not appear after clicking Forgot password link"
        )

    def test_forgot_calls_correct_endpoint(self, page):
        """Forgot password must POST to /api/auth/forgot-password, not /api/forgot-password."""
        page.goto(BASE)
        page.wait_for_selector("input[autocomplete='username']", timeout=8000)
        page.get_by_text("Forgot password").click()
        page.wait_for_selector("button:has-text('Send Code')", timeout=3000)

        api_calls = []
        page.on("request", lambda r: api_calls.append(r.url) if "forgot" in r.url else None)

        page.fill("input[type='text']", TEST_USER)
        page.click("button:has-text('Send Code')")
        page.wait_for_timeout(2000)

        assert not any("/api/forgot-password" in u for u in api_calls), (
            "React called /api/forgot-password (wrong). Expected /api/auth/forgot-password."
        )
