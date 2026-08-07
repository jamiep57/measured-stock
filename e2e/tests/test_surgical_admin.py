"""Surgical coverage for admin surfaces outside the event stock loop."""

from __future__ import annotations

import re

from playwright.sync_api import expect

from helpers.auth import goto_admin_path, goto_event_panel
from helpers.db import E2E_PREFIX, new_run_id
from helpers.pages import (
    click_id,
    expect_toast,
    open_toolbar_sheet,
    poll_until,
)


def test_30_reports_panel_loads(admin_page, seed):
    goto_event_panel(admin_page, seed.event_id, "reports")
    expect(admin_page.locator("#reportsPanel")).to_be_visible(timeout=25000)
    # Kind toggles should be present.
    expect(
        admin_page.locator('[data-report-kind="clients"], [data-report-kind="suppliers"]').first
    ).to_be_visible(timeout=10000)


def test_31_kit_library_panel_loads(admin_page):
    goto_admin_path(admin_page, "/kit-library")
    expect(admin_page.locator(".kit-lib-panel, #kitLibTable").first).to_be_visible(timeout=25000)


def test_32_warehouses_panel_loads(admin_page):
    goto_admin_path(admin_page, "/warehouses")
    expect(admin_page.locator(".wh-panel, #whList").first).to_be_visible(timeout=25000)


def test_33_volume_pools_panel_loads(admin_page):
    goto_admin_path(admin_page, "/volume-pools")
    expect(admin_page.locator(".vp-panel, #vpList").first).to_be_visible(timeout=25000)


def test_34_settings_users_panel_loads(admin_page):
    """Users settings mounts; local Vite may 404 /api/auth/users — still assert shell."""
    goto_admin_path(admin_page, "/settings/users")
    expect(admin_page.locator(".users-section")).to_be_visible(timeout=25000)
    # Either the table/list renders, or the API error is shown (no Vercel API locally).
    expect(
        admin_page.locator("#usersTable, .users-section").get_by_text(
            re.compile(r"@|Failed to load users|No users|Invite", re.I)
        ).first
    ).to_be_visible(timeout=15000)


def test_41_recon_inline_edit_and_save(admin_page, seed, db):
    """Edit closing cases on recon (more reliable than invoice override) and save."""
    goto_event_panel(admin_page, seed.event_id, "recon")
    expect(admin_page.locator("#rcnPanel")).to_be_visible(timeout=25000)
    row = admin_page.locator(f'.recon-row[data-rcn-pid="{seed.product_id}"]')
    expect(row).to_be_visible(timeout=20000)
    cases = admin_page.locator(f"#rcn-cl-cases-{seed.product_id}")
    expect(cases).to_be_visible(timeout=10000)
    admin_page.evaluate(
        """(pid) => {
          const el = document.getElementById(`rcn-cl-cases-${pid}`);
          if (!el) throw new Error('missing closing cases input');
          el.focus();
          el.value = '11';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        seed.product_id,
    )
    admin_page.wait_for_function(
        "() => { const el = document.getElementById('rcnSaveBar'); return !!(el && !el.hidden); }",
        timeout=5000,
    )
    click_id(admin_page, "rcnSaveBtn")

    poll_until(
        lambda: (
            db.table("closing_stock")
            .select("closing_cases")
            .eq("event_id", seed.event_id)
            .eq("product_id", seed.product_id)
            .limit(1)
            .execute()
            .data
            or [{}]
        )[0].get("closing_cases"),
        predicate=lambda q: q is not None and float(q) == 11.0,
        label="closing_cases=11 via recon",
        timeout_s=15,
    )


def test_43_setup_status_change_persists(admin_page, seed_minimal, db):
    goto_event_panel(admin_page, seed_minimal.event_id, "setup")
    status = admin_page.locator("#setupStatus")
    expect(status).to_be_visible(timeout=20000)
    # Wait until paint finishes with the seeded value before flipping.
    expect(status).to_have_value("active", timeout=15000)
    status.select_option("draft")
    status.dispatch_event("change")
    poll_until(
        lambda: (
            db.table("events")
            .select("status")
            .eq("id", seed_minimal.event_id)
            .limit(1)
            .execute()
            .data
            or [{}]
        )[0].get("status"),
        predicate=lambda s: s == "draft",
        label="event status=draft",
        timeout_s=12,
    )


def test_35_settings_categories_and_case_sizes(admin_page):
    goto_admin_path(admin_page, "/settings/categories")
    expect(admin_page.locator("#settingsCategories")).to_be_visible(timeout=20000)
    goto_admin_path(admin_page, "/settings/case-sizes")
    expect(admin_page.locator("#settingsCaseSizes")).to_be_visible(timeout=20000)


def test_36_legacy_users_route_rewrites_to_settings(admin_page):
    goto_admin_path(admin_page, "/users")
    expect(admin_page).to_have_url(re.compile(r"/settings/users"), timeout=15000)
    expect(admin_page.locator(".users-section, #usersTable").first).to_be_visible(timeout=15000)


def test_37_event_audit_alias_rewrites_to_dev(admin_page, seed):
    goto_admin_path(admin_page, f"/events/{seed.event_id}/audit")
    expect(admin_page).to_have_url(re.compile(r"/dev/audit"), timeout=15000)
    expect(admin_page.locator("#auditPanel")).to_be_visible(timeout=25000)


def test_38_route_aliases_opening_and_summary(admin_page, seed):
    # opening → products; summary → reports (client rewrite may interrupt Playwright goto).
    goto_admin_path(admin_page, f"/events/{seed.event_id}/opening")
    expect(admin_page.locator("#epPanel")).to_be_visible(timeout=25000)
    expect(admin_page).to_have_url(re.compile(r"/events/[^/]+/products"), timeout=10000)
    goto_admin_path(admin_page, f"/events/{seed.event_id}/summary")
    expect(admin_page.locator("#reportsPanel")).to_be_visible(timeout=25000)
    expect(admin_page).to_have_url(re.compile(r"/events/[^/]+/reports"), timeout=10000)


def test_39_panel_nav_stress_no_blank_content(admin_page, seed):
    panels = [
        ("dashboard", "#dashPanel"),
        ("products", "#epPanel"),
        ("distribution", "#distPanel, #distGrid"),
        ("deliveries", "#delList"),
        ("closing", "#closingPanel"),
        ("recon", "#rcnPanel"),
        ("setup", "#setupName"),
    ]
    for panel, selector in panels:
        goto_event_panel(admin_page, seed.event_id, panel)
        expect(admin_page.locator(selector).first).to_be_visible(timeout=25000)
        # Content mount must never be empty after route resolve.
        kids = admin_page.evaluate(
            "() => document.getElementById('adminContent')?.children.length || 0"
        )
        assert kids > 0, f"blank adminContent after {panel}"


def test_40_suppliers_create_via_ui(admin_page, db, tracker):
    name = f"{E2E_PREFIX} UI Supplier {new_run_id()}"
    goto_admin_path(admin_page, "/suppliers")
    expect(admin_page.locator(".sup-panel")).to_be_visible(timeout=20000)
    open_toolbar_sheet(admin_page, "new-supplier", "#supName")
    admin_page.locator("#supName").fill(name)
    # Leave SOR blank — num-math field has been flaky when filled oddly.
    click_id(admin_page, "supSave")
    rows = poll_until(
        lambda: (
            db.table("suppliers").select("id, name").eq("name", name).limit(1).execute().data
            or []
        ),
        predicate=lambda r: bool(r),
        label=f"supplier {name}",
        timeout_s=15,
    )
    tracker.track_supplier(rows[0]["id"])
    expect(admin_page.locator("#supList").get_by_text(name, exact=False)).to_be_visible(
        timeout=15000
    )


def test_42_library_search_seeded_product(admin_page, seed):
    goto_admin_path(admin_page, "/library")
    expect(admin_page.locator(".lib-panel")).to_be_visible(timeout=20000)
    # Global topbar product search drives library filtering.
    inp = admin_page.locator("#topbarSearch .product-search-input").first
    expect(inp).to_be_visible(timeout=10000)
    inp.click()
    inp.fill("")
    inp.press_sequentially(seed.product_name, delay=20)
    expect(
        admin_page.locator("#libBody").get_by_text(seed.product_name, exact=False)
    ).to_be_visible(timeout=15000)
