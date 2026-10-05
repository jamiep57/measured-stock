"""Supabase helpers for E2E seed + cleanup."""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass, field
from typing import Optional

from supabase import Client, create_client


E2E_PREFIX = "[E2E]"


def _env(*keys: str, default: str = "") -> str:
    for key in keys:
        val = (os.getenv(key) or "").strip()
        if val:
            return val
    return default


def _jwt_ref(token: str) -> str:
    """Best-effort project ref from a Supabase JWT (anon/service)."""
    import base64
    import json

    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload.encode("utf-8")))
        return str(data.get("ref") or "")
    except Exception:
        return ""


def _url_ref(url: str) -> str:
    from urllib.parse import urlparse

    host = urlparse(url).hostname or ""
    return host.split(".")[0] if host else ""


def make_supabase_client(*, prefer_service: bool = True) -> Client:
    """
    PostgREST client for seed/cleanup.

    Migration 062 revokes anon table grants. Prefer a *matching* service-role
    key (same project ref as SUPABASE_URL). Otherwise sign in as E2E_EMAIL.
    """
    url = _env(
        "SUPABASE_URL",
        "E2E_SUPABASE_URL",
        "SYNC_SUPABASE_URL",
        "V2_SUPABASE_URL",
    )
    service = _env(
        "SUPABASE_SERVICE_KEY",
        "E2E_SUPABASE_SERVICE_KEY",
        "SYNC_SUPABASE_SERVICE_KEY",
        "V2_SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
    )
    anon = _env("SUPABASE_ANON_KEY", "E2E_SUPABASE_ANON_KEY")

    if not url:
        raise RuntimeError("Set SUPABASE_URL in e2e/.env")

    url_ref = _url_ref(url)
    if prefer_service and service and _jwt_ref(service) in ("", url_ref):
        # Empty ref check: some JWTs omit ref; still try when explicitly set as SUPABASE_SERVICE_KEY
        if _jwt_ref(service) == url_ref or (
            not _jwt_ref(service) and _env("SUPABASE_SERVICE_KEY")
        ):
            return create_client(url, service)
        # Mismatched project — ignore (common when SYNC_* points at another ref)

    if not anon:
        raise RuntimeError(
            "Set SUPABASE_ANON_KEY and either a matching SUPABASE_SERVICE_KEY "
            "or E2E_EMAIL / E2E_PASSWORD in e2e/.env"
        )

    client = create_client(url, anon)
    email = _env("E2E_EMAIL")
    password = _env("E2E_PASSWORD")
    if not email or not password:
        raise RuntimeError(
            "DB fixtures need an active admin session. Set E2E_EMAIL + E2E_PASSWORD "
            "in e2e/.env (or a service-role key for the same project as SUPABASE_URL)."
        )
    res = client.auth.sign_in_with_password({"email": email, "password": password})
    if not res.session:
        raise RuntimeError("E2E sign-in failed — check E2E_EMAIL / E2E_PASSWORD")
    return client


def cloud_config_for_browser() -> dict[str, str]:
    """Anon (publishable) credentials injected into the browser before db.js loads."""
    url = _env(
        "SUPABASE_URL",
        "E2E_SUPABASE_URL",
        "SYNC_SUPABASE_URL",
        "V2_SUPABASE_URL",
    )
    key = _env("SUPABASE_ANON_KEY", "E2E_SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("Need SUPABASE_URL + SUPABASE_ANON_KEY for browser injection")
    return {"url": url.rstrip("/"), "key": key}


@dataclass
class SeededWorld:
    """IDs created for one test — always deleted in teardown."""

    run_id: str
    event_id: Optional[str] = None
    event_name: str = ""
    supplier_id: Optional[str] = None
    product_id: Optional[str] = None
    product_name: str = ""
    category_id: Optional[str] = None
    bar_id: Optional[str] = None
    bar_name: str = "E2E Main Bar"
    recipient_id: Optional[str] = None
    recipient_name: str = "E2E Production"
    event_product_id: Optional[str] = None
    delivery_id: Optional[str] = None
    transfer_id: Optional[str] = None
    wastage_id: Optional[str] = None
    count_id: Optional[str] = None
    count_name: str = ""
    created_category: bool = False
    extra_product_ids: list[str] = field(default_factory=list)
    extra_supplier_ids: list[str] = field(default_factory=list)
    extra_event_ids: list[str] = field(default_factory=list)

    def track_event(self, event_id: str) -> None:
        if event_id and event_id not in self.extra_event_ids and event_id != self.event_id:
            self.extra_event_ids.append(event_id)

    def track_product(self, product_id: str) -> None:
        if product_id and product_id not in self.extra_product_ids and product_id != self.product_id:
            self.extra_product_ids.append(product_id)

    def track_supplier(self, supplier_id: str) -> None:
        if (
            supplier_id
            and supplier_id not in self.extra_supplier_ids
            and supplier_id != self.supplier_id
        ):
            self.extra_supplier_ids.append(supplier_id)


def new_run_id() -> str:
    return uuid.uuid4().hex[:10]


def _reuse_or_create_category(db: Client, world: SeededWorld) -> str:
    existing = (
        db.table("categories")
        .select("id,name")
        .ilike("name", "BEER")
        .limit(1)
        .execute()
        .data
    )
    if existing:
        return existing[0]["id"]
    existing = (
        db.table("categories").select("id,name").order("sort_order").limit(1).execute().data
    )
    if existing:
        return existing[0]["id"]
    created = (
        db.table("categories")
        .insert(
            {
                "name": f"{E2E_PREFIX} Cat {world.run_id}",
                "colour_key": "rtd",
                "sort_order": 9999,
            }
        )
        .execute()
        .data
    )
    world.created_category = True
    return created[0]["id"]


def seed_world(db: Client, *, full: bool = True) -> SeededWorld:
    """
    Insert a self-contained event graph tagged with [E2E].

    When full=True also seeds delivery, transfer, bar menu, distribution,
    opening quantities, and closing stock so UI panels have something to show.
    """
    world = SeededWorld(run_id=new_run_id())
    world.event_name = f"{E2E_PREFIX} Event {world.run_id}"
    world.product_name = f"{E2E_PREFIX} Lager {world.run_id}"
    supplier_name = f"{E2E_PREFIX} Supplier {world.run_id}"

    world.category_id = _reuse_or_create_category(db, world)

    supplier = (
        db.table("suppliers")
        .insert({"name": supplier_name, "default_sor_pct": 30})
        .execute()
        .data
    )
    world.supplier_id = supplier[0]["id"]

    product = (
        db.table("products")
        .insert(
            {
                "name": world.product_name,
                "supplier_id": world.supplier_id,
                "category_id": world.category_id,
                "sku": f"E2E-{world.run_id}",
                "case_size": "24 x 330ml",
                "units_per_case": 24,
                "case_price": 18.5,
                "unit_price": 0.77,
                "stock_unit": "case",
            }
        )
        .execute()
        .data
    )
    world.product_id = product[0]["id"]
    # Confirm the product row is readable before event_products (avoids rare FK races).
    assert (
        db.table("products").select("id").eq("id", world.product_id).limit(1).execute().data
    ), f"seeded product {world.product_id} missing immediately after insert"

    # Preferred offer row (multi-supplier model)
    try:
        db.table("product_suppliers").insert(
            {
                "product_id": world.product_id,
                "supplier_id": world.supplier_id,
                "sku": f"E2E-{world.run_id}",
                "pack_size": "24 x 330ml",
                "units_per_case": 24,
                "case_price": 18.5,
                "unit_price": 0.77,
                "is_preferred": True,
            }
        ).execute()
    except Exception:
        # Older schemas without pack_size still accept the core columns.
        db.table("product_suppliers").insert(
            {
                "product_id": world.product_id,
                "supplier_id": world.supplier_id,
                "sku": f"E2E-{world.run_id}",
                "case_price": 18.5,
                "unit_price": 0.77,
                "is_preferred": True,
            }
        ).execute()

    event = (
        db.table("events")
        .insert(
            {
                "name": world.event_name,
                "status": "active",
                "start_date": "2026-08-01",
                "end_date": "2026-08-03",
                "venue": "E2E Test Venue",
                "venue_postcode": "E2E 1AA",
            }
        )
        .execute()
        .data
    )
    world.event_id = event[0]["id"]

    bar = (
        db.table("bars")
        .insert({"event_id": world.event_id, "name": world.bar_name})
        .execute()
        .data
    )
    world.bar_id = bar[0]["id"]

    recip = (
        db.table("recipients")
        .insert(
            {
                "event_id": world.event_id,
                "name": world.recipient_name,
                "department": "Ops",
            }
        )
        .execute()
        .data
    )
    world.recipient_id = recip[0]["id"]

    if not full:
        # Product exists in library but is not yet on the event — UI can add it.
        return world

    ep = (
        db.table("event_products")
        .insert(
            {
                "event_id": world.event_id,
                "product_id": world.product_id,
                "qty_ordered": 40,
                "invoice_qty": 40,
                "delivered_qty": 40,
                "damaged_qty": 0,
                "already_in_stock": 0,
            }
        )
        .execute()
        .data
    )
    world.event_product_id = ep[0]["id"]

    db.table("bar_products").insert(
        {
            "event_id": world.event_id,
            "bar_id": world.bar_id,
            "product_id": world.product_id,
        }
    ).execute()

    db.table("distribution").insert(
        {
            "event_id": world.event_id,
            "bar_id": world.bar_id,
            "product_id": world.product_id,
            "qty_allocated": 10,
        }
    ).execute()

    delivery = (
        db.table("deliveries")
        .insert(
            {
                "event_id": world.event_id,
                "supplier_id": world.supplier_id,
                "notes": f"{E2E_PREFIX} seeded delivery {world.run_id}",
            }
        )
        .execute()
        .data
    )
    world.delivery_id = delivery[0]["id"]

    db.table("delivery_lines").insert(
        {
            "delivery_id": world.delivery_id,
            "product_id": world.product_id,
            "qty": 40,
            "singles": 0,
            "damaged_qty": 0,
            "invoice_qty": 40,
        }
    ).execute()

    transfer = (
        db.table("transfers")
        .insert(
            {
                "transfer_type": "event_to_recipient",
                "from_event_id": world.event_id,
                "recipient_id": world.recipient_id,
                "unit": "cases",
                "notes": f"{E2E_PREFIX} seeded transfer {world.run_id}",
            }
        )
        .execute()
        .data
    )
    world.transfer_id = transfer[0]["id"]

    db.table("transfer_lines").insert(
        {
            "transfer_id": world.transfer_id,
            "product_id": world.product_id,
            "qty": 2,
            "singles": 0,
        }
    ).execute()

    db.table("closing_stock").insert(
        {
            "event_id": world.event_id,
            "product_id": world.product_id,
            "close_count": 5,
            "return_amount": 5,
            "carried_over": 0,
            "closing_cases": 5,
            "closing_singles": 0,
        }
    ).execute()

    world.count_name = f"{E2E_PREFIX} Count {world.run_id}"
    count = (
        db.table("stock_counts")
        .insert(
            {
                "event_id": world.event_id,
                "bar_id": world.bar_id,
                "name": world.count_name,
            }
        )
        .execute()
        .data
    )
    world.count_id = count[0]["id"]
    db.table("stock_count_lines").insert(
        {
            "count_id": world.count_id,
            "product_id": world.product_id,
            "bar_id": world.bar_id,
            "cases": 3,
            "singles": 2,
        }
    ).execute()

    wastage = (
        db.table("wastage_batches")
        .insert(
            {
                "event_id": world.event_id,
                "unit": "cases",
                "reason": "Breakage / spillage",
                "notes": f"{E2E_PREFIX} seeded wastage {world.run_id}",
            }
        )
        .execute()
        .data
    )
    world.wastage_id = wastage[0]["id"]
    db.table("wastage_lines").insert(
        {
            "batch_id": world.wastage_id,
            "product_id": world.product_id,
            "qty": 1,
            "singles": 0,
        }
    ).execute()

    return world


def _delete_product(db: Client, product_id: str) -> None:
    if not product_id:
        return
    try:
        db.rpc("delete_product", {"p_id": product_id}).execute()
        return
    except Exception:
        pass
    # Manual fallback matching assets/js/db.js deleteFull
    for table, col in (
        ("kit_container_contents", "container_product_id"),
        ("kit_container_contents", "child_product_id"),
        ("kit_movement_lines", "product_id"),
        ("event_kit_items", "product_id"),
        ("stock_count_lines", "product_id"),
        ("wastage_lines", "product_id"),
        ("transfer_lines", "product_id"),
        ("delivery_lines", "product_id"),
        ("topup_lines", "product_id"),
        ("bar_products", "product_id"),
        ("distribution", "product_id"),
        ("closing_stock", "product_id"),
        ("supplier_return_lines", "product_id"),
        ("event_products", "product_id"),
        ("warehouse_stock", "product_id"),
        ("product_suppliers", "product_id"),
        ("recipe_ingredients", "product_id"),
    ):
        try:
            db.table(table).delete().eq(col, product_id).execute()
        except Exception:
            continue
    db.table("products").delete().eq("id", product_id).execute()


def cleanup_world(db: Client, world: SeededWorld) -> None:
    """Delete everything this test created. Safe to call multiple times."""
    event_ids = [eid for eid in [world.event_id, *world.extra_event_ids] if eid]
    for event_id in event_ids:
        try:
            db.table("events").delete().eq("id", event_id).execute()
        except Exception:
            pass

    product_ids = [pid for pid in [world.product_id, *world.extra_product_ids] if pid]
    for product_id in product_ids:
        try:
            _delete_product(db, product_id)
        except Exception:
            pass

    supplier_ids = [sid for sid in [world.supplier_id, *world.extra_supplier_ids] if sid]
    for supplier_id in supplier_ids:
        try:
            db.table("suppliers").delete().eq("id", supplier_id).execute()
        except Exception:
            pass

    if world.created_category and world.category_id:
        try:
            db.table("categories").delete().eq("id", world.category_id).execute()
        except Exception:
            pass


def sweep_orphaned_e2e(db: Client) -> dict[str, int]:
    """Session-end safety net: remove any leftover [E2E] rows.

    Never raises — leftover FK references or concurrent UI deletes should not
    fail the suite. Order: events → E2E-named products → products still pointing
    at E2E suppliers → suppliers → categories.
    """
    counts = {"events": 0, "products": 0, "suppliers": 0, "categories": 0}

    events = (
        db.table("events").select("id").ilike("name", f"{E2E_PREFIX}%").execute().data or []
    )
    for row in events:
        try:
            db.table("events").delete().eq("id", row["id"]).execute()
            counts["events"] += 1
        except Exception:
            pass

    products = (
        db.table("products").select("id").ilike("name", f"{E2E_PREFIX}%").execute().data or []
    )
    for row in products:
        try:
            _delete_product(db, row["id"])
            counts["products"] += 1
        except Exception:
            pass

    suppliers = (
        db.table("suppliers").select("id").ilike("name", f"{E2E_PREFIX}%").execute().data or []
    )
    supplier_ids = [row["id"] for row in suppliers if row.get("id")]
    # Clear products that still reference E2E suppliers (name may not match prefix).
    for supplier_id in supplier_ids:
        try:
            linked = (
                db.table("products").select("id").eq("supplier_id", supplier_id).execute().data
                or []
            )
        except Exception:
            linked = []
        for prow in linked:
            try:
                _delete_product(db, prow["id"])
                counts["products"] += 1
            except Exception:
                try:
                    db.table("products").update({"supplier_id": None}).eq(
                        "id", prow["id"]
                    ).execute()
                except Exception:
                    pass

    for supplier_id in supplier_ids:
        try:
            db.table("suppliers").delete().eq("id", supplier_id).execute()
            counts["suppliers"] += 1
        except Exception:
            pass

    categories = (
        db.table("categories").select("id").ilike("name", f"{E2E_PREFIX}%").execute().data or []
    )
    for row in categories:
        try:
            db.table("categories").delete().eq("id", row["id"]).execute()
            counts["categories"] += 1
        except Exception:
            pass

    return counts
