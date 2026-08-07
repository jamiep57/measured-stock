"""Small page helpers shared across scenario tests."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any, Callable, Optional

if TYPE_CHECKING:
    from playwright.sync_api import Locator, Page


def click_toolbar(page: "Page", action: str) -> None:
    btn = page.locator(f'[data-toolbar-action="{action}"]').first
    btn.wait_for(state="visible", timeout=15000)
    btn.click()


def expect_toast(page: "Page", text: str, timeout: int = 10000) -> None:
    """Assert toast text via #toast only (avoid matching panel titles)."""
    page.wait_for_function(
        """(expected) => {
          const el = document.getElementById('toast');
          if (!el) return false;
          const shown = el.classList.contains('show') || el.classList.contains('toast--show');
          const visible = !!(el.offsetParent || el.getClientRects().length);
          return (shown || visible) && (el.textContent || '').includes(expected);
        }""",
        arg=text,
        timeout=timeout,
    )


def sheet_root(page: "Page") -> "Locator":
    return page.locator("#sheet")


def wait_sheet_open(page: "Page", field_selector: str, timeout: int = 15000) -> None:
    page.locator(field_selector).wait_for(state="visible", timeout=timeout)


def open_toolbar_sheet(page: "Page", action: str, field_selector: str, retries: int = 8) -> None:
    """Click a toolbar action until the sheet field appears (remount races)."""
    last_err: Optional[Exception] = None
    for _ in range(retries):
        try:
            click_toolbar(page, action)
            page.locator(field_selector).wait_for(state="visible", timeout=1500)
            return
        except Exception as err:
            last_err = err
            time.sleep(0.2)
    raise AssertionError(f"sheet for {action!r} did not open ({field_selector})") from last_err


def accept_next_dialogs(page: "Page") -> None:
    page.once("dialog", lambda dialog: dialog.accept())


def pick_search_item(page: "Page", query: str, *, scope: Optional["Locator"] = None, item_text: Optional[str] = None) -> None:
    """Type into a product/supplier search and click the matching list item.

    Sheet drawers animate; force-click the input. Dropdown lists may be clipped
    or portaled, so attach-wait + force-click the match.
    """
    root = scope if scope is not None else page.locator("body")
    # Wait for drawer animation to settle when the sheet is open.
    try:
        page.locator("#sheet.sheet--visible").wait_for(state="attached", timeout=3000)
    except Exception:
        pass
    inp = root.locator(".product-search-input, .supplier-search-input").first
    inp.wait_for(state="attached", timeout=10000)
    inp.click(force=True)
    inp.fill("")
    inp.press_sequentially(query, delay=30)
    target = item_text or query
    # Prefer real product rows over the "+ Create …" affordance.
    item = page.locator(".product-search-item:not(.product-search-create-trigger)").filter(
        has_text=target
    ).first
    try:
        item.wait_for(state="attached", timeout=8000)
    except Exception:
        # Fall back to any item containing the text (including create).
        item = page.locator(".product-search-item").filter(has_text=target).first
        item.wait_for(state="attached", timeout=5000)
    item.click(force=True)


def poll_until(
    fn: Callable[[], Any],
    *,
    predicate: Optional[Callable[[Any], bool]] = None,
    timeout_s: float = 12.0,
    interval_s: float = 0.3,
    label: str = "condition",
) -> Any:
    """Poll a callable until predicate(result) is true (default: truthy)."""
    deadline = time.monotonic() + timeout_s
    last = None
    check = predicate or (lambda v: bool(v))
    while time.monotonic() < deadline:
        last = fn()
        if check(last):
            return last
        time.sleep(interval_s)
    raise AssertionError(f"timed out waiting for {label}: last={last!r}")


def fill_blur(locator: "Locator", value: str) -> None:
    locator.click()
    locator.fill(value)
    locator.blur()


def fill_line_cases(page: "Page", cases_locator: "Locator", value: str) -> None:
    """Set a delivery/transfer/wastage cases field and fire oninput (updates in-memory lines)."""
    cases_locator.wait_for(state="attached", timeout=10000)
    cases_locator.evaluate(
        """(el, value) => {
          el.focus();
          el.value = String(value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        value,
    )


def click_id(page: "Page", element_id: str) -> None:
    """Click by id via DOM (avoids overlay/num-math intercepting Playwright pointer clicks)."""
    page.evaluate(
        """(id) => {
          const el = document.getElementById(id);
          if (!el) throw new Error('missing #' + id);
          el.click();
        }""",
        element_id,
    )
