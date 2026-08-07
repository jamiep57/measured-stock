"""Additional E2E coverage beyond the top-10 happy paths."""

from __future__ import annotations

import time

from playwright.sync_api import expect

from helpers.auth import goto_admin_path, goto_event_panel
from helpers.db import E2E_PREFIX


def _poll_event_name(db, event_id: str, expected: str, timeout_s: float = 10.0) -> None:
    deadline = time.monotonic() + timeout_s
    last = None
    while time.monotonic() < deadline:
        rows = (
            db.table("events").select("name").eq("id", event_id).limit(1).execute().data or []
        )
        last = (rows[0].get("name") if rows else None)
        if last == expected:
            return
        time.sleep(0.25)
    raise AssertionError(f"event name not updated: got {last!r}, want {expected!r}")


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


def test_15_suppliers_list_shows_seeded(admin_page, seed):
    """Suppliers catalog lists the fixture supplier (searchable)."""
    goto_admin_path(admin_page, "/suppliers")
    expect(admin_page.locator(".sup-panel")).to_be_visible(timeout=20000)
    # Seed creates "[E2E] Supplier {run_id}"
    supplier_name = f"{E2E_PREFIX} Supplier {seed.run_id}"
    admin_page.locator("#supSearch").fill(supplier_name)
    expect(admin_page.locator("#supList").get_by_text(supplier_name, exact=False)).to_be_visible(
        timeout=15000
    )


def test_16_setup_edit_event_name(admin_page, seed_minimal, db):
    goto_event_panel(admin_page, seed_minimal.event_id, "setup")
    expect(admin_page.locator("#setupName")).to_be_visible(timeout=20000)
    expect(admin_page.locator("#setupName")).to_have_value(seed_minimal.event_name, timeout=15000)
    new_name = f"{seed_minimal.event_name} Updated"
    name = admin_page.locator("#setupName")
    name.click()
    name.fill(new_name)
    name.blur()
    # Autosave is on blur → events.update; assert via DB.
    _poll_event_name(db, seed_minimal.event_id, new_name)
    seed_minimal.event_name = new_name


def test_17_audit_panel_loads(admin_page, seed):
    # Audit lives under /dev; event audit URLs rewrite there.
    goto_admin_path(admin_page, "/dev/audit")
    # Ensure the seeded event is the active workspace for the audit panel.
    admin_page.evaluate(
        """(eventId) => {
          try { sessionStorage.setItem('v5-admin-active-event', eventId); } catch (e) {}
        }""",
        seed.event_id,
    )
    admin_page.reload(wait_until="domcontentloaded")
    expect(admin_page.locator("#auditPanel")).to_be_visible(timeout=25000)
