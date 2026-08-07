"""DB seed/cleanup smoke tests (no browser)."""

from helpers.db import cleanup_world, seed_world, sweep_orphaned_e2e


def test_seed_and_cleanup_roundtrip(db):
    world = seed_world(db, full=True)
    assert world.event_id
    assert world.product_id
    assert world.delivery_id
    assert world.transfer_id

    found = (
        db.table("events")
        .select("id,name")
        .eq("id", world.event_id)
        .execute()
        .data
    )
    assert found and found[0]["name"] == world.event_name

    cleanup_world(db, world)

    gone = (
        db.table("events")
        .select("id")
        .eq("id", world.event_id)
        .execute()
        .data
    )
    assert not gone

    products = (
        db.table("products")
        .select("id")
        .eq("id", world.product_id)
        .execute()
        .data
    )
    assert not products


def test_orphan_sweep_is_safe(db):
    # Should not raise even when there is nothing to clean.
    counts = sweep_orphaned_e2e(db)
    assert set(counts) >= {"events", "products", "suppliers", "categories"}
