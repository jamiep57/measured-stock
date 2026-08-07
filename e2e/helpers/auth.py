"""Browser auth + navigation helpers (Supabase Auth email/password)."""

from __future__ import annotations

import json
import os
import re
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from helpers.db import cloud_config_for_browser

if TYPE_CHECKING:
    from playwright.sync_api import Page


def base_url() -> str:
    return (os.getenv("BASE_URL") or "https://localhost:5173").rstrip("/")


def inject_cloud_config(page: "Page") -> None:
    """Ensure the SPA talks to the same Supabase project the fixtures seed."""
    cfg = cloud_config_for_browser()
    page.add_init_script(
        f"""
        window.__CLOUD_CONFIG__ = {json.dumps(cfg)};
        try {{
          localStorage.setItem('measured_stock_cloud', JSON.stringify(window.__CLOUD_CONFIG__));
        }} catch (e) {{}}
        """
    )


def _supabase_storage_key(supabase_url: str) -> str:
    host = urlparse(supabase_url).hostname or ""
    # Project ref is the subdomain, e.g. qqdvzcaukstfdixnfuqq.supabase.co
    ref = host.split(".")[0] if host else "supabase"
    return f"sb-{ref}-auth-token"


def inject_supabase_session(page: "Page", session: dict) -> None:
    """
    Persist a Supabase Auth session so ensureAppAuth() finds it on load.
    `session` is the dict returned by sign_in_with_password (access_token, …).
    """
    cfg = cloud_config_for_browser()
    key = _supabase_storage_key(cfg["url"])
    payload = {
        "access_token": session.get("access_token"),
        "token_type": session.get("token_type") or "bearer",
        "expires_in": session.get("expires_in"),
        "expires_at": session.get("expires_at"),
        "refresh_token": session.get("refresh_token"),
        "user": session.get("user"),
    }
    page.add_init_script(
        f"""
        try {{
          localStorage.setItem({json.dumps(key)}, JSON.stringify({json.dumps(payload)}));
        }} catch (e) {{}}
        """
    )


def _jsonable(obj):
    """Convert supabase session objects into plain JSON-safe values."""
    from datetime import date, datetime

    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if hasattr(obj, "model_dump"):
        return _jsonable(obj.model_dump())
    if hasattr(obj, "dict"):
        return _jsonable(obj.dict())
    if hasattr(obj, "json"):
        try:
            return json.loads(obj.json())
        except Exception:
            pass
    return str(obj)


def sign_in_via_api() -> dict:
    """Sign in with E2E_EMAIL / E2E_PASSWORD using the Supabase Auth API."""
    from supabase import create_client

    from helpers.db import cloud_config_for_browser

    email = (os.getenv("E2E_EMAIL") or "").strip()
    password = (os.getenv("E2E_PASSWORD") or "").strip()
    if not email or not password:
        raise RuntimeError(
            "Set E2E_EMAIL and E2E_PASSWORD in e2e/.env "
            "(active admin profile required)"
        )
    cfg = cloud_config_for_browser()
    client = create_client(cfg["url"], cfg["key"])
    res = client.auth.sign_in_with_password({"email": email, "password": password})
    if not res.session:
        raise RuntimeError("Supabase sign-in returned no session")
    sess = res.session
    if hasattr(sess, "model_dump"):
        data = sess.model_dump()
    elif hasattr(sess, "dict"):
        data = sess.dict()
    else:
        data = {
            "access_token": sess.access_token,
            "token_type": getattr(sess, "token_type", None) or "bearer",
            "expires_in": sess.expires_in,
            "expires_at": sess.expires_at,
            "refresh_token": sess.refresh_token,
            "user": sess.user,
        }
    data = _jsonable(data)
    return {
        "access_token": data.get("access_token") or sess.access_token,
        "token_type": data.get("token_type") or "bearer",
        "expires_in": data.get("expires_in"),
        "expires_at": data.get("expires_at"),
        "refresh_token": data.get("refresh_token") or sess.refresh_token,
        "user": data.get("user"),
    }


def unlock_admin(page: "Page", *, use_ui_login: bool = False) -> None:
    """
    Open admin authenticated.

    Default: inject a Supabase session from E2E_EMAIL/E2E_PASSWORD (fast, stable).
    Set use_ui_login=True to exercise the /login email form.
    """
    url = f"{base_url()}/v5/admin"

    if use_ui_login:
        email = (os.getenv("E2E_EMAIL") or "").strip()
        password = (os.getenv("E2E_PASSWORD") or "").strip()
        if not email or not password:
            raise RuntimeError("E2E_EMAIL and E2E_PASSWORD required for UI login")

        page.goto(f"{base_url()}/login", wait_until="domcontentloaded")
        page.locator("#emailForm").wait_for(state="visible", timeout=15000)
        # Prefer waiting for login.js; fall through if method=post already protects GET leaks.
        try:
            page.wait_for_function(
                """() => {
                  const form = document.getElementById('emailForm');
                  return !!(form && form.getAttribute('data-ready') === '1');
                }""",
                timeout=10000,
            )
        except Exception:
            page.wait_for_load_state("networkidle")
        page.locator("#email").fill(email)
        page.locator("#password").fill(password)
        page.locator("#emailBtn").click()
        page.wait_for_url(re.compile(r".*/v5/admin"), timeout=30000)
        page.wait_for_selector("#adminApp, #homeNewEvent, .admin-app", timeout=20000)
        return

    session = sign_in_via_api()
    inject_supabase_session(page, session)
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_selector("#adminApp, #homeNewEvent, .admin-app", timeout=20000)


def goto_admin_path(page: "Page", path: str) -> None:
    """Navigate within admin after unlock. path like /v5/admin/library."""
    if not path.startswith("/"):
        path = "/" + path
    page.goto(f"{base_url()}{path}", wait_until="domcontentloaded")
    page.wait_for_selector("#adminApp, .admin-app", timeout=20000)


def goto_event_panel(page: "Page", event_id: str, panel: str) -> None:
    goto_admin_path(page, f"/v5/admin/events/{event_id}/{panel}")
