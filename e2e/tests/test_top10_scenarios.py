"""
Top 10 E2E scenarios for Measured Stock V5 admin.

Each test that touches the database uses fixtures that seed [E2E]-tagged rows
and delete them afterwards. Prefer a non-production Supabase project/branch.
"""

from __future__ import annotations

import re

from playwright.sync_api import expect

from helpers.auth import goto_admin_path, goto_event_panel
from helpers.db import E2E_PREFIX, new_run_id
from helpers.pages import click_toolbar


# ---------------------------------------------------------------------------
# 1. Admin login (email form)
# ---------------------------------------------------------------------------

def test_01_admin_login_via_email_form(page):
    """Sign in through /login email form and land on admin home."""
    from helpers.auth import inject_cloud_config, unlock_admin

    inject_cloud_config(page)
    unlock_admin(page, use_ui_login=True)
    expect(page.locator("#homeNewEvent")).to_be_visible(timeout=20000)
    expect(page.get_by_text("Pick an event workspace", exact=False)).to_be_visible()


# ---------------------------------------------------------------------------
# 2. Create event (UI)
# ---------------------------------------------------------------------------

def test_02_create_event_via_ui(admin_page, db, tracker):
    """Create an event from the home sheet; fixture cleans it up."""
    name = f"{E2E_PREFIX} UI Event {new_run_id()}"
    goto_admin_path(admin_page, "/")
    expect(admin_page.locator("#homeNewEvent")).to_be_visible(timeout=20000)
    expect(admin_page.locator(".home-page, .home-toolbar").first).to_be_visible(timeout=10000)
    # mountHomePanel attaches the click listener after first paint — retry briefly.
    opened = False
    for _ in range(10):
        admin_page.locator("#homeNewEvent").click()
        try:
            admin_page.locator("#homeEventName").wait_for(state="visible", timeout=1000)
            opened = True
            break
        except Exception:
            continue
    assert opened, "New event sheet did not open"
    admin_page.locator("#homeEventName").fill(name)
    admin_page.locator("#homeEventStatus").select_option("active")
    admin_page.locator("#homeEventVenue").fill("E2E UI Venue")
    admin_page.locator("#homeEventSave").click()

    admin_page.wait_for_url(re.compile(r"/events/[^/]+/setup"), timeout=20000)
    expect(admin_page.locator("#setupName")).to_have_value(name, timeout=15000)

    # Track for cleanup (created outside seed fixture)
    m = re.search(r"/events/([^/]+)/", admin_page.url)
    assert m, "expected event id in URL"
    tracker.event_id = m.group(1)
    tracker.event_name = name


# ---------------------------------------------------------------------------
# 3. Event setup — add a bar
# ---------------------------------------------------------------------------

def test_03_setup_add_bar(admin_page, seed_minimal, tracker):
    """Add a bar on the event setup page."""
    bar_name = f"E2E Bar {seed_minimal.run_id}"
    goto_event_panel(admin_page, seed_minimal.event_id, "setup")
    expect(admin_page.locator("#setupName")).to_be_visible(timeout=15000)

    admin_page.locator("#setupAddBar").click()
    admin_page.locator("#setupBarName").fill(bar_name)
    admin_page.locator("#setupBarSave").click()

    expect(admin_page.locator("#setupBars").get_by_text(bar_name)).to_be_visible(timeout=10000)


# ---------------------------------------------------------------------------
# 4. Library — create product
# ---------------------------------------------------------------------------

def test_04_library_create_product(admin_page, db, tracker):
    """Create a library product via New product toolbar action."""
    product_name = f"{E2E_PREFIX} UI Product {new_run_id()}"
    goto_admin_path(admin_page, "/library")
    expect(admin_page.locator(".lib-panel").first).to_be_visible(timeout=20000)

    click_toolbar(admin_page, "new-product")
    admin_page.locator("#libName").fill(product_name)
    # Category is optional if select has a blank option; pick first real value if present
    cat = admin_page.locator("#libCategoryId")
    options = cat.locator("option").all()
    if len(options) > 1:
        cat.select_option(index=1)
    admin_page.locator("#libSave").click()

    expect(admin_page.get_by_text(product_name, exact=False).first).to_be_visible(timeout=15000)

    rows = (
        db.table("products")
        .select("id")
        .eq("name", product_name)
        .limit(1)
        .execute()
        .data
        or []
    )
    assert rows, "product should exist in DB after UI create"
    tracker.track_product(rows[0]["id"])


# ---------------------------------------------------------------------------
# 5. Add product to event catalogue
# ---------------------------------------------------------------------------

def test_05_add_product_to_event(admin_page, seed_minimal):
    """Add the seeded library product onto the event products grid via UI."""
    db_product = seed_minimal.product_name
    goto_event_panel(admin_page, seed_minimal.event_id, "products")
    expect(admin_page.locator("#epPanel, #epBody, .ep-panel").first).to_be_visible(timeout=20000)
    # Wait for library + event load (Add uses in-memory library from refresh()).
    expect(admin_page.get_by_text("Loading products…")).to_have_count(0, timeout=30000)
    expect(admin_page.locator("#epEmpty")).to_be_visible(timeout=15000)

    click_toolbar(admin_page, "add-event-product")
    search = admin_page.get_by_placeholder("Search library to add…")
    expect(search).to_be_visible(timeout=10000)
    search.fill("")
    search.press_sequentially(db_product, delay=20)
    item = admin_page.locator(".product-search-item").filter(has_text=db_product)
    expect(item.first).to_be_visible(timeout=15000)
    item.first.click()
    expect(
        admin_page.locator("#epBody").get_by_text(db_product, exact=False)
    ).to_be_visible(timeout=15000)


# ---------------------------------------------------------------------------
# 6. Distribution — product on bar menu
# ---------------------------------------------------------------------------

def test_06_distribution_shows_allocation(admin_page, seed):
    """Distribution grid lists the seeded product and bar allocation."""
    goto_event_panel(admin_page, seed.event_id, "distribution")
    expect(admin_page.locator("#distPanel, #distGrid, .dist-prod-row").first).to_be_visible(
        timeout=20000
    )
    expect(admin_page.get_by_text(seed.product_name, exact=False).first).to_be_visible()
    # Bar column / cell for seeded bar
    expect(admin_page.get_by_text(seed.bar_name, exact=False).first).to_be_visible()


# ---------------------------------------------------------------------------
# 7. Deliveries — seeded delivery visible
# ---------------------------------------------------------------------------

def test_07_deliveries_list_seeded_delivery(admin_page, seed):
    """Deliveries panel shows the fixture delivery card."""
    goto_event_panel(admin_page, seed.event_id, "deliveries")
    expect(admin_page.locator("#delList")).to_be_visible(timeout=20000)
    expect(admin_page.locator(f'[data-delivery-id="{seed.delivery_id}"]')).to_be_visible(
        timeout=15000
    )
    expect(admin_page.get_by_text(seed.product_name, exact=False).first).to_be_visible()


# ---------------------------------------------------------------------------
# 8. Transfers — seeded transfer visible
# ---------------------------------------------------------------------------

def test_08_transfers_list_seeded_transfer(admin_page, seed):
    """Transfers panel shows the fixture transfer."""
    goto_event_panel(admin_page, seed.event_id, "transfers")
    expect(admin_page.locator("#xferList")).to_be_visible(timeout=20000)
    card = admin_page.locator(f'[data-transfer-id="{seed.transfer_id}"]')
    expect(card).to_be_visible(timeout=15000)
    expect(admin_page.get_by_text(seed.product_name, exact=False).first).to_be_visible()


# ---------------------------------------------------------------------------
# 9. Closing stock — product row
# ---------------------------------------------------------------------------

def test_09_closing_shows_product_row(admin_page, seed):
    """Closing panel renders a row for the seeded product."""
    goto_event_panel(admin_page, seed.event_id, "closing")
    expect(admin_page.locator("#closingPanel, #clTable, #clBody").first).to_be_visible(
        timeout=20000
    )
    expect(admin_page.get_by_text(seed.product_name, exact=False).first).to_be_visible()
    row = admin_page.locator(f'.cl-row[data-cl-pid="{seed.product_id}"]')
    if row.count():
        expect(row.first).to_be_visible()


# ---------------------------------------------------------------------------
# 10. Financial recon — product appears
# ---------------------------------------------------------------------------

def test_10_recon_shows_product(admin_page, seed):
    """Recon panel loads and includes the seeded product."""
    goto_event_panel(admin_page, seed.event_id, "recon")
    expect(admin_page.locator("#rcnPanel, #rcnTable, #rcnBody").first).to_be_visible(
        timeout=25000
    )
    expect(admin_page.get_by_text(seed.product_name, exact=False).first).to_be_visible(
        timeout=20000
    )


# ---------------------------------------------------------------------------
# Bonus sanity: seeded event card on home
# ---------------------------------------------------------------------------

def test_seeded_event_appears_on_home(admin_page, seed):
    goto_admin_path(admin_page, "/")
    card = admin_page.locator(".event-card").filter(has_text=seed.event_name)
    expect(card.first).to_be_visible(timeout=20000)
