"""Small page helpers shared across scenario tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from playwright.sync_api import Page, Locator


def click_toolbar(page: "Page", action: str) -> None:
    page.locator(f'[data-toolbar-action="{action}"]').first.click()


def expect_toast(page: "Page", text: str, timeout: int = 10000) -> None:
    page.get_by_text(text, exact=False).first.wait_for(state="visible", timeout=timeout)


def sheet_visible(page: "Page") -> "Locator":
    return page.locator(".sheet, .admin-sheet, [data-sheet], .drawer").first
