"""
Pytest + Playwright fixtures.

- Seeds tagged [E2E] rows via Supabase before each test that needs them
- Deletes those rows after the test (and sweeps orphans at session end)
- Injects the same Supabase project into the browser so UI + fixtures agree
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from dotenv import load_dotenv

from helpers.auth import base_url, inject_cloud_config, unlock_admin
from helpers.db import (
    SeededWorld,
    cleanup_world,
    make_supabase_client,
    seed_world,
    sweep_orphaned_e2e,
)

ROOT = Path(__file__).resolve().parent
# Prefer e2e/.env; also allow repo-root .env.local for PIN/URL convenience.
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env.local", override=False)
load_dotenv(ROOT.parent / ".env.development.local", override=False)


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args):
    """Prefer system Chrome when PLAYWRIGHT_CHANNEL=chrome (avoids long CTF download)."""
    channel = (os.getenv("PLAYWRIGHT_CHANNEL") or "").strip()
    args = {**browser_type_launch_args}
    if channel:
        args["channel"] = channel
    return args


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {
        **browser_context_args,
        "ignore_https_errors": True,
        "viewport": {"width": 1440, "height": 900},
    }


@pytest.fixture(scope="session")
def base_url_cfg():
    return base_url()


@pytest.fixture(scope="session")
def db():
    client = make_supabase_client()
    yield client
    # Safety net if a test crashed before its own cleanup.
    try:
        sweep_orphaned_e2e(client)
    except Exception as exc:  # pragma: no cover - best-effort
        print(f"[e2e] orphan sweep failed: {exc}")


@pytest.fixture
def seed(db) -> SeededWorld:
    """Full event graph: product, bar, delivery, transfer, closing, distribution."""
    world = seed_world(db, full=True)
    try:
        yield world
    finally:
        cleanup_world(db, world)


@pytest.fixture
def seed_minimal(db) -> SeededWorld:
    """Event + product only — for create-flow tests that add their own rows."""
    world = seed_world(db, full=False)
    try:
        yield world
    finally:
        cleanup_world(db, world)


@pytest.fixture
def tracker(db) -> SeededWorld:
    """Empty tracker for UI-created entities (still cleaned up)."""
    from helpers.db import new_run_id

    world = SeededWorld(run_id=new_run_id())
    try:
        yield world
    finally:
        cleanup_world(db, world)


@pytest.fixture
def admin_page(page):
    """Authenticated admin page pointed at the configured test database."""
    inject_cloud_config(page)
    unlock_admin(page)
    return page


def pytest_configure(config):
    # Make pytest-base-url / playwright baseURL match our env.
    os.environ.setdefault("BASE_URL", base_url())
