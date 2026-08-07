"""
Surgical write-path coverage for core stock flows.

Goes beyond smoke “panel loads” — creates/edits via UI and asserts DB or list state.
"""

from __future__ import annotations

import re
import time

from playwright.sync_api import expect

from helpers.auth import goto_event_panel
from helpers.db import E2E_PREFIX
from helpers.pages import (
    accept_next_dialogs,
    click_id,
    expect_toast,
    fill_blur,
    fill_line_cases,
    open_toolbar_sheet,
    pick_search_item,
    poll_until,
)


def test_20_delivery_create_via_ui(admin_page, seed, db):
    notes = f"{E2E_PREFIX} UI delivery {seed.run_id}"
    goto_event_panel(admin_page, seed.event_id, "deliveries")
    # Wait until event payload is loaded (seeded card) before opening the form.
    expect(admin_page.locator(f'[data-delivery-id="{seed.delivery_id}"]')).to_be_visible(
        timeout=20000
    )
    open_toolbar_sheet(admin_page, "log-delivery", "#dfSave")
    admin_page.locator("#sheet.sheet--visible").wait_for(state="attached", timeout=5000)

    admin_page.locator("#dfReference").fill(f"E2E-REF-{seed.run_id}")
    admin_page.locator("#dfNotes").fill(notes)

    pick_search_item(admin_page, seed.product_name, scope=admin_page.locator("#dfProductSearch"))
    cases = admin_page.locator("#dfLines .del-line-cases").first
    fill_line_cases(admin_page, cases, "3")

    click_id(admin_page, "dfSave")
    poll_until(
        lambda: (
            db.table("deliveries")
            .select("id, notes")
            .eq("event_id", seed.event_id)
            .ilike("notes", f"%{notes}%")
            .execute()
            .data
            or []
        ),
        predicate=lambda rows: bool(rows),
        label="delivery row in DB",
        timeout_s=15,
    )
    expect(admin_page.locator("#delList").get_by_text(notes, exact=False)).to_be_visible(
        timeout=15000
    )


def test_21_transfer_create_via_ui(admin_page, seed, db):
    goto_event_panel(admin_page, seed.event_id, "transfers")
    expect(admin_page.locator(f'[data-transfer-id="{seed.transfer_id}"]')).to_be_visible(
        timeout=20000
    )
    before = len(
        db.table("transfers").select("id").eq("from_event_id", seed.event_id).execute().data
        or []
    )
    open_toolbar_sheet(admin_page, "log-transfer", "#xfSave")
    admin_page.locator("#sheet.sheet--visible").wait_for(state="attached", timeout=5000)

    # Source: Bone Yard (goods in) for this event.
    source = admin_page.locator("#xfSource")
    source.wait_for(state="attached", timeout=10000)
    admin_page.wait_for_function(
        """() => {
          const sel = document.getElementById('xfSource');
          return !!(sel && sel.options && sel.options.length > 1);
        }""",
        timeout=15000,
    )
    try:
        source.select_option(label=re.compile(r"Bone Yard", re.I))
    except Exception:
        source.select_option(value=f"event:{seed.event_id}")
    dest = admin_page.locator("#xfDest")
    admin_page.wait_for_function(
        """() => {
          const sel = document.getElementById('xfDest');
          return !!(sel && Array.from(sel.options).some(o => (o.value || '').startsWith('recipient:')));
        }""",
        timeout=10000,
    )
    try:
        dest.select_option(value=f"recipient:{seed.recipient_id}")
    except Exception:
        dest.select_option(label=re.compile(r"E2E Production", re.I))

    pick_search_item(admin_page, seed.product_name, scope=admin_page.locator("#xfProductSearch"))
    cases = admin_page.locator("#xfLines .del-line-cases").first
    fill_line_cases(admin_page, cases, "1")

    click_id(admin_page, "xfSave")
    poll_until(
        lambda: (
            db.table("transfers")
            .select("id")
            .eq("from_event_id", seed.event_id)
            .execute()
            .data
            or []
        ),
        predicate=lambda rows: len(rows) > before,
        label="extra transfer row",
        timeout_s=15,
    )


def test_22_wastage_create_via_ui(admin_page, seed, db):
    notes = f"{E2E_PREFIX} UI wastage {seed.run_id}"
    goto_event_panel(admin_page, seed.event_id, "wastage")
    expect(admin_page.locator(f'[data-batch-id="{seed.wastage_id}"]')).to_be_visible(
        timeout=20000
    )
    before = len(
        db.table("wastage_batches").select("id").eq("event_id", seed.event_id).execute().data
        or []
    )
    open_toolbar_sheet(admin_page, "log-wastage", "#wfSave")
    admin_page.locator("#sheet.sheet--visible").wait_for(state="attached", timeout=5000)

    reason = admin_page.locator("#wfReason")
    options = reason.locator("option").all_text_contents()
    if options:
        for opt in options:
            val = (opt or "").strip()
            if val:
                reason.select_option(label=val)
                break

    notes_el = admin_page.locator("#wfNotes")
    if notes_el.count():
        notes_el.fill(notes)

    pick_search_item(admin_page, seed.product_name, scope=admin_page.locator("#wfProductSearch"))
    cases = admin_page.locator("#wfLines .del-line-cases").first
    fill_line_cases(admin_page, cases, "1")

    click_id(admin_page, "wfSave")
    poll_until(
        lambda: (
            db.table("wastage_batches")
            .select("id")
            .eq("event_id", seed.event_id)
            .execute()
            .data
            or []
        ),
        predicate=lambda rows: len(rows) > before,
        label="extra wastage batch",
        timeout_s=15,
    )


def test_23_distribution_edit_allocation(admin_page, seed, db):
    goto_event_panel(admin_page, seed.event_id, "distribution")
    expect(admin_page.locator("#distGrid")).to_be_visible(timeout=25000)
    cell = admin_page.locator(
        f'.dist-cell[data-bar="{seed.bar_id}"][data-pid="{seed.product_id}"]'
    )
    expect(cell).to_be_visible(timeout=15000)
    inp = cell.locator(".dist-pill-input")
    # Seed allocates 10 — change to 7 and wait for 500ms debounce + network.
    inp.click()
    inp.fill("7")
    # Trigger input event path used by panel listener.
    inp.dispatch_event("input")
    time.sleep(0.8)
    inp.blur()

    poll_until(
        lambda: (
            db.table("distribution")
            .select("qty_allocated")
            .eq("event_id", seed.event_id)
            .eq("bar_id", seed.bar_id)
            .eq("product_id", seed.product_id)
            .limit(1)
            .execute()
            .data
            or [{}]
        )[0].get("qty_allocated"),
        predicate=lambda q: float(q or 0) == 7.0,
        label="distribution qty_allocated=7",
        timeout_s=15,
    )


def test_24_closing_edit_cases_blur_saves(admin_page, seed, db):
    goto_event_panel(admin_page, seed.event_id, "closing")
    expect(admin_page.locator("#closingPanel")).to_be_visible(timeout=25000)
    inp = admin_page.locator(f'#cl-cases-{seed.product_id}')
    expect(inp).to_be_visible(timeout=15000)
    fill_blur(inp, "9")

    poll_until(
        lambda: (
            db.table("closing_stock")
            .select("closing_cases, close_count")
            .eq("event_id", seed.event_id)
            .eq("product_id", seed.product_id)
            .limit(1)
            .execute()
            .data
            or [{}]
        )[0],
        predicate=lambda row: float(row.get("closing_cases") or 0) == 9.0,
        label="closing_cases=9",
        timeout_s=15,
    )


def test_25_counts_create_session(admin_page, seed):
    name = f"{E2E_PREFIX} Count UI {seed.run_id}"
    goto_event_panel(admin_page, seed.event_id, "counts")
    expect(admin_page.locator("#cntPanel")).to_be_visible(timeout=20000)
    open_toolbar_sheet(admin_page, "new-count", "#cntNewName")
    admin_page.locator("#cntNewName").fill(name)
    click_id(admin_page, "cntNewSave")
    expect(admin_page.locator("#cntSessionSelect")).to_contain_text(name, timeout=15000)


def test_26_setup_add_recipient(admin_page, seed_minimal):
    name = f"{E2E_PREFIX} Recip {seed_minimal.run_id}"
    goto_event_panel(admin_page, seed_minimal.event_id, "setup")
    expect(admin_page.locator("#setupAddRecip")).to_be_visible(timeout=20000)
    admin_page.locator("#setupAddRecip").click()
    expect(admin_page.locator("#setupRecipName")).to_be_visible(timeout=10000)
    admin_page.locator("#setupRecipName").fill(name)
    dept = admin_page.locator("#setupRecipDept")
    if dept.count():
        dept.fill("E2E Ops")
    admin_page.locator("#setupRecipSave").click()
    expect(admin_page.locator(".setup-panel").get_by_text(name, exact=False)).to_be_visible(
        timeout=15000
    )


def test_27_delivery_delete_seeded(admin_page, seed, db):
    """Delete the seeded delivery via UI confirm and assert DB gone."""
    goto_event_panel(admin_page, seed.event_id, "deliveries")
    card = admin_page.locator(f'[data-delivery-id="{seed.delivery_id}"]')
    expect(card).to_be_visible(timeout=20000)
    accept_next_dialogs(admin_page)
    card.locator("[data-del]").click()
    poll_until(
        lambda: (
            db.table("deliveries").select("id").eq("id", seed.delivery_id).execute().data or []
        ),
        predicate=lambda rows: len(rows) == 0,
        label="delivery deleted",
        timeout_s=12,
    )
