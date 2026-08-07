"""Additional E2E coverage beyond the top-10 happy paths."""

from __future__ import annotations

import re

from playwright.sync_api import expect

from helpers.auth import goto_admin_path, goto_event_panel
from helpers.db import E2E_PREFIX, new_run_id
from helpers.pages import click_toolbar


def test_11_dashboard_loads(admin_page, seed):
    goto_event_panel(admin_page, seed.event_id, "dashboard")
    expect(admin_page.locator("#dashPanel")).to_be_visible(timeout=25000)
    expect(admin_page.get_by_text("Loading dashboard…")).to_have_count(0, timeout=25000)


def test_12_wastage_shows_seeded_batch(admin_page, seed):
    goto_event_panel(admin_page, seed.event_id, "wastage")
    expect(admin_page.locator("#wstList")).to_be_visible(timeout=20000)
    expect(admin_page.locator(f'[data-batch-id="{seed.wastage_id}"]')).to_be_visible(
        timeout=15000
    )
    expect(admin_page.get_by_text(seed.product_name, exact=False).first).to_be_visible()


def test_13_counts_shows_seeded_session(admin_page, seed):
    goto_event_panel(admin_page, seed.event_id, "counts")
    expect(admin_page.locator("#cntPanel")).to_be_visible(timeout=20000)
    expect(admin_page.locator("#cntSessionSelect")).to_be_visible(timeout=15000)
    # Session select should include the seeded count name.
    expect(admin_page.locator("#cntSessionSelect")).to_contain_text(seed.count_name)
    expect(admin_page.get_by_text(seed.product_name, exact=False).first).to_be_visible(
        timeout=15000
    )


def test_14_sales_panel_loads(admin_page, seed):
    goto_event_panel(admin_page, seed.event_id, "sales")
    expect(admin_page.locator("#salesPanel")).to_be_visible(timeout=25000)
    expect(admin_page.locator('.sales-tab[data-tab="items"]')).to_be_visible(timeout=10000)


def test_15_suppliers_create_via_ui(admin_page, db, tracker):
    name = f"{E2E_PREFIX} UI Supplier {new_run_id()}"
    goto_admin_path(admin_page, "/v5/admin/suppliers")
    expect(admin_page.locator(".sup-panel")).to_be_visible(timeout=20000)
    click_toolbar(admin_page, "new-supplier")
    expect(admin_page.locator("#supName")).to_be_visible(timeout=10000)
    admin_page.locator("#supName").fill(name)
    admin_page.locator("#supSor").fill("25")
    admin_page.locator("#supSave").click()
    expect(admin_page.get_by_text(name, exact=False).first).to_be_visible(timeout=15000)
    rows = (
        db.table("suppliers").select("id").eq("name", name).limit(1).execute().data or []
    )
    assert rows, "supplier should exist after UI create"
    tracker.track_supplier(rows[0]["id"])


def test_16_setup_edit_event_name(admin_page, seed_minimal):
    goto_event_panel(admin_page, seed_minimal.event_id, "setup")
    expect(admin_page.locator("#setupName")).to_be_visible(timeout=15000)
    new_name = f"{seed_minimal.event_name} Updated"
    admin_page.locator("#setupName").fill(new_name)
    admin_page.locator("#setupName").dispatch_event("blur")
    expect(admin_page.locator("#setupSaved-name")).to_have_text("Saved", timeout=10000)
    expect(admin_page.locator("#setupName")).to_have_value(new_name)
    seed_minimal.event_name = new_name


def test_17_audit_panel_loads(admin_page, seed):
    goto_event_panel(admin_page, seed.event_id, "audit")
    expect(admin_page.locator("#auditPanel")).to_be_visible(timeout=25000)
