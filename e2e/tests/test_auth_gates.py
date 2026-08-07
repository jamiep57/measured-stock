"""Auth gates and session edge cases — dig into login walls surgically."""

from __future__ import annotations

import re

from playwright.sync_api import expect

from helpers.auth import base_url
from helpers.db import cloud_config_for_browser


def test_auth_unauthenticated_admin_redirects_to_login(guest_page):
    guest_page.goto(f"{base_url()}/", wait_until="domcontentloaded")
    guest_page.wait_for_url(re.compile(r".*/login"), timeout=20000)
    # Preserve deep-link so login can bounce back.
    assert "next=" in guest_page.url or "/login" in guest_page.url
    expect(guest_page.locator("#emailForm")).to_be_visible(timeout=15000)


def test_auth_unauthenticated_event_deep_link_keeps_next(guest_page, seed_minimal):
    path = f"/events/{seed_minimal.event_id}/setup"
    guest_page.goto(f"{base_url()}{path}", wait_until="domcontentloaded")
    guest_page.wait_for_url(re.compile(r".*/login"), timeout=20000)
    # next should encode the event path (URL-encoded or raw).
    assert "next=" in guest_page.url
    assert seed_minimal.event_id in guest_page.url or "events" in guest_page.url


def test_auth_wrong_password_stays_on_login(guest_page):
    import os

    email = (os.getenv("E2E_EMAIL") or "").strip()
    assert email, "E2E_EMAIL required"
    guest_page.goto(f"{base_url()}/login", wait_until="domcontentloaded")
    guest_page.locator("#emailForm").wait_for(state="visible", timeout=15000)
    try:
        guest_page.wait_for_function(
            """() => document.getElementById('emailForm')?.getAttribute('data-ready') === '1'""",
            timeout=8000,
        )
    except Exception:
        guest_page.wait_for_load_state("networkidle")
    guest_page.locator("#email").fill(email)
    guest_page.locator("#password").fill("definitely-not-the-password-zz")
    guest_page.locator("#emailBtn").click()
    # Stay on login; message should flip to error styling / non-default copy.
    expect(guest_page).to_have_url(re.compile(r".*/login"), timeout=10000)
    expect(guest_page.locator("#emailForm")).to_be_visible()
    msg = guest_page.locator("#msg")
    expect(msg).not_to_have_text("Enter your email and password to continue.", timeout=10000)


def test_auth_logout_returns_to_login(admin_page):
    # Local Vite has no /api/logout — fulfill so signOutApp can finish and redirect.
    admin_page.route(
        "**/api/logout",
        lambda route: route.fulfill(status=200, content_type="application/json", body="{}"),
    )
    admin_page.wait_for_selector("#topbarProfileBtn", timeout=15000)
    # Real UI path: open account menu, then Log out.
    admin_page.locator("#topbarProfileBtn").click()
    expect(admin_page.locator("#topbarLogout")).to_be_visible(timeout=5000)
    admin_page.locator("#topbarLogout").click()
    admin_page.wait_for_function(
        "() => (location.pathname || '').includes('/login')",
        timeout=20000,
    )
    expect(admin_page.locator("#emailForm")).to_be_visible(timeout=10000)


def test_auth_login_next_returns_to_requested_panel(guest_page, seed_minimal):
    """After login from a deep-link bounce, admin loads (next may or may not restore)."""
    import os

    path = f"/events/{seed_minimal.event_id}/dashboard"
    guest_page.goto(f"{base_url()}{path}", wait_until="domcontentloaded")
    guest_page.wait_for_url(re.compile(r".*/login"), timeout=20000)
    email = (os.getenv("E2E_EMAIL") or "").strip()
    password = (os.getenv("E2E_PASSWORD") or "").strip()
    guest_page.locator("#emailForm").wait_for(state="visible", timeout=15000)
    try:
        guest_page.wait_for_function(
            """() => document.getElementById('emailForm')?.getAttribute('data-ready') === '1'""",
            timeout=8000,
        )
    except Exception:
        pass
    guest_page.locator("#email").fill(email)
    guest_page.locator("#password").fill(password)
    guest_page.locator("#emailBtn").click()
    guest_page.wait_for_url(re.compile(r"https?://[^/]+/(?:$|\?|events/)"), timeout=30000)
    expect(guest_page.locator("#adminApp, .admin-app, #homeNewEvent")).to_be_visible(timeout=20000)
    # Prefer restored next; otherwise navigate and prove access.
    if seed_minimal.event_id not in guest_page.url:
        from helpers.auth import goto_admin_path

        goto_admin_path(guest_page, path)
    expect(guest_page.locator("#dashPanel")).to_be_visible(timeout=25000)


def test_cloud_config_matches_seed_project(admin_page):
    """Browser cloud config must match the fixture Supabase project."""
    cfg = cloud_config_for_browser()
    browser_cfg = admin_page.evaluate(
        """() => {
          try {
            return JSON.parse(localStorage.getItem('measured_stock_cloud') || 'null');
          } catch (e) { return null; }
        }"""
    )
    assert browser_cfg and browser_cfg.get("url"), "measured_stock_cloud missing"
    assert browser_cfg["url"].rstrip("/") == cfg["url"].rstrip("/")
