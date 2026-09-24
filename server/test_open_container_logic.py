"""
Tests for the open-container stock model (Product.unit_stock_mode ==
'open_container') -- accessories whose pack contents vary or can't be counted.

Runs against a throwaway in-memory SQLite database, NOT the live one, so it is
safe to run at any time and needs no seeded users or orders:

    python test_open_container_logic.py

Covers the dispatcher paths in core/inventory/inventoryService.py that a real
checkout goes through (_process_line_items / _restore_line_items), since those
are where a mistake would silently corrupt stock.
"""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlmodel import Session, create_engine, select, text

from entities.products import Product
from entities.variants import Variant
from entities.offcuts import Offcut
from entities.attributes import AttributeClass
from entities.openContainers import OpenContainer
from entities.editHistory import EditHistory
from entities.stockInputSession import StockInputSessionItem
from entities.orders import Order
from entities.orderItems import OrderItem
from core.inventory.openContainers.service import convert_product_stock_mode, _utilization
from core.inventory.openContainers.utilization import variant_utilization, container_usage
from core.inventory.poolKey import load_attribute_types, pool_key_from_attributes
from core.inventory.inventoryService import (
    _process_line_items,
    _restore_line_items,
    is_open_container_mode,
    find_open_container,
    _pieces_per_pack_unit,
)

PASS, FAIL = [], []


def check(label, condition, detail=""):
    (PASS if condition else FAIL).append(label)
    print(f"  {'PASS' if condition else 'FAIL'}  {label}{(' -- ' + detail) if detail and not condition else ''}")


def fresh_db():
    """Only the tables these paths touch. The full metadata isn't used because
    entities/users.py pins a Postgres-specific UUID column type -- so `users`
    is declared here by hand instead, just enough for the served-by lookup in
    the sales drill-down to resolve (or resolve to nobody) rather than error."""
    engine = create_engine("sqlite://")
    for entity in (Product, Variant, Offcut, OpenContainer, AttributeClass,
                   EditHistory, StockInputSessionItem, Order, OrderItem):
        entity.__table__.create(engine, checkfirst=True)
    with Session(engine) as db:
        db.exec(text(
            'CREATE TABLE IF NOT EXISTS users ('
            '"userId" VARCHAR PRIMARY KEY, "firstName" VARCHAR, "secondName" VARCHAR, '
            '"phoneNumber" VARCHAR, role VARCHAR, email VARCHAR, username VARCHAR, '
            'password VARCHAR, "mustChangePassword" BOOLEAN, "isActive" BOOLEAN, '
            '"createdAt" TIMESTAMP)'
        ))
        db.commit()
    return engine


def seed_user(db, username="cashier1"):
    uid = uuid4()
    db.exec(text('INSERT INTO users ("userId", "firstName", username, role) VALUES (:i, :f, :u, :r)')
            .bindparams(i=str(uid), f="Test", u=username, r="cashier"))
    db.commit()
    return uid


def seed(db, mode="open_container", stock=4, pack=100.0):
    # Pool-key rules depend on these: a "custom"-typed attribute carries the
    # pack SIZE, so variants differing only by it share one pool (poolKey.py).
    if not db.exec(select(AttributeClass)).first():
        db.add(AttributeClass(name="Color", type="list"))
        db.add(AttributeClass(name="Unit", type="custom"))
        db.commit()
    product = Product(
        name="Rubber Gasket", category_id=1, stock_quantity=stock,
        track_offcuts=False, has_variants=True, unit="m", unit_stock_mode=mode,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    variant = Variant(
        product_id=product.productId, name="White - 100m Roll",
        attributes={"Color": "White", "Unit": "100m"},
        stock_quantity=stock, price=5000.0, price_unit=60.0, unit_quantity=pack,
    )
    db.add(variant)
    db.commit()
    db.refresh(variant)
    return product, variant


def variant_pool_key(db, product, variant):
    return pool_key_from_attributes(
        variant.attributes, load_attribute_types(db), product.pool_ignored_attributes
    )


def open_one(db, product, variant):
    """Stands in for openContainers/service.open_container -- same row, without
    the audit/user plumbing this test deliberately doesn't build."""
    container = OpenContainer(
        product_id=product.productId, variant_id=variant.variantId,
        pool_key=variant_pool_key(db, product, variant), status="open",
        nominal_quantity=variant.unit_quantity, units_sold=0.0,
    )
    db.add(container)
    db.commit()
    db.refresh(container)
    return container


def run():
    print("\n[1] Mode detection")
    engine = fresh_db()
    with Session(engine) as db:
        product, variant = seed(db)
        check("open_container product is detected", is_open_container_mode(product))
        check("whole-pack sale applies no pack-size multiplier",
              _pieces_per_pack_unit(product, variant) == 1.0,
              f"got {_pieces_per_pack_unit(product, variant)}")

        counted, counted_variant = seed(db, mode="counted")
        check("counted product is not detected", not is_open_container_mode(counted))
        check("counted whole-pack sale still multiplies by pack size",
              _pieces_per_pack_unit(counted, counted_variant) == 100.0,
              f"got {_pieces_per_pack_unit(counted, counted_variant)}")

        cutter = Product(name="Bar", category_id=1, track_offcuts=True, unit_stock_mode="open_container")
        check("an offcut-tracked product is never open-container", not is_open_container_mode(cutter))

    print("\n[2] Sub-pack sale with nothing open is refused")
    engine = fresh_db()
    with Session(engine) as db:
        product, variant = seed(db)
        line = {"type": "accessory-pcs", "qty": 12}
        try:
            _process_line_items(db, product, variant, [line])
            check("raises when no pack is open", False, "no error raised")
        except ValueError as e:
            check("raises when no pack is open", "No open pack" in str(e), str(e))
        db.refresh(variant)
        check("sealed stock untouched by the refused sale", variant.stock_quantity == 4,
              f"got {variant.stock_quantity}")

    print("\n[3] Sub-pack sale against an open pack")
    engine = fresh_db()
    with Session(engine) as db:
        product, variant = seed(db)
        container = open_one(db, product, variant)
        line = {"type": "accessory-pcs", "qty": 12}
        _process_line_items(db, product, variant, [line])
        db.commit()
        db.refresh(container)
        db.refresh(variant)
        db.refresh(product)

        check("tally advanced by the units sold", container.units_sold == 12.0, f"got {container.units_sold}")
        check("sealed stock NOT decremented", variant.stock_quantity == 4, f"got {variant.stock_quantity}")
        check("product total NOT decremented", product.stock_quantity == 4, f"got {product.stock_quantity}")
        check("no offcut row was created", db.exec(select(Offcut)).first() is None)
        check("source recorded for a later restore",
              (line.get("stock_sources") or [{}])[0].get("source") == "open_container",
              str(line.get("stock_sources")))

        # A sale far beyond the pack's nominal size must still succeed: what is
        # left inside is deliberately unknown, so there is no ceiling to hit.
        _process_line_items(db, product, variant, [{"type": "accessory-pcs", "qty": 5000}])
        db.commit()
        db.refresh(container)
        check("a sale beyond the nominal pack size is allowed", container.units_sold == 5012.0,
              f"got {container.units_sold}")

    print("\n[4] Restoring a sub-pack sale")
    engine = fresh_db()
    with Session(engine) as db:
        product, variant = seed(db)
        container = open_one(db, product, variant)
        line = {"type": "accessory-pcs", "qty": 30}
        _process_line_items(db, product, variant, [line])
        db.commit()

        _restore_line_items(db, product, variant, [line])
        db.commit()
        db.refresh(container)
        db.refresh(variant)
        check("tally rolled back", container.units_sold == 0.0, f"got {container.units_sold}")
        check("restore did not invent sealed stock", variant.stock_quantity == 4,
              f"got {variant.stock_quantity}")

        # A finished pack still accepts the rollback, but must not be reopened:
        # whether it is physically empty is not something a refund can know.
        _process_line_items(db, product, variant, [line])
        db.commit()
        container.status = "finished"
        db.add(container)
        db.commit()
        _restore_line_items(db, product, variant, [line])
        db.commit()
        db.refresh(container)
        check("closed pack's tally still rolls back", container.units_sold == 0.0, f"got {container.units_sold}")
        check("closed pack is not reopened by a refund", container.status == "finished", container.status)

    print("\n[5] A legacy line with no open-container source restores nothing")
    engine = fresh_db()
    with Session(engine) as db:
        product, variant = seed(db)
        open_one(db, product, variant)
        # Sold under the counted model (pieces), before the switch.
        legacy = {"type": "accessory-pcs", "qty": 500}
        _restore_line_items(db, product, variant, [legacy])
        db.commit()
        db.refresh(variant)
        check("no phantom stock invented from a pieces-denominated legacy line",
              variant.stock_quantity == 4, f"got {variant.stock_quantity} (expected 4, not 504)")

    print("\n[6] Whole-pack sale deducts packs, not pieces")
    engine = fresh_db()
    with Session(engine) as db:
        product, variant = seed(db)
        _process_line_items(db, product, variant, [{"type": "accessory-unit", "qty": 2}])
        db.commit()
        db.refresh(variant)
        check("2 packs sold leaves 2 packs", variant.stock_quantity == 2, f"got {variant.stock_quantity}")

        _restore_line_items(db, product, variant, [{"type": "accessory-unit", "qty": 2}])
        db.commit()
        db.refresh(variant)
        check("restoring 2 packs returns to 4", variant.stock_quantity == 4, f"got {variant.stock_quantity}")

    print("\n[7] Counted mode is unchanged by any of this")
    engine = fresh_db()
    with Session(engine) as db:
        product, variant = seed(db, mode="counted", stock=2000, pack=1000.0)
        _process_line_items(db, product, variant, [{"type": "accessory-pcs", "qty": 300}])
        db.commit()
        db.refresh(variant)
        # 1 sealed box opened for 300 pcs; 700 left over go to the shared loose pool.
        check("a box was opened, not partially consumed", variant.stock_quantity == 1000,
              f"got {variant.stock_quantity}")
        loose = db.exec(select(Offcut)).first()
        check("the exact remainder went to the loose pool", loose is not None and loose.length == 700,
              f"got {loose.length if loose else None}")

        _process_line_items(db, product, variant, [{"type": "accessory-unit", "qty": 1}])
        db.commit()
        db.refresh(variant)
        check("a counted whole-box sale still deducts a full pack size",
              variant.stock_quantity == 0, f"got {variant.stock_quantity}")

    print("\n[8] FIFO: the oldest open pack is dispensed from first")
    engine = fresh_db()
    with Session(engine) as db:
        product, variant = seed(db)
        first = open_one(db, product, variant)
        second = open_one(db, product, variant)
        _process_line_items(db, product, variant, [{"type": "accessory-pcs", "qty": 7}])
        db.commit()
        db.refresh(first)
        db.refresh(second)
        check("oldest pack took the sale", first.units_sold == 7.0 and second.units_sold == 0.0,
              f"first={first.units_sold} second={second.units_sold}")
        check("find_open_container agrees",
              find_open_container(db, product, variant_pool_key(db, product, variant)).id == first.id)

    print("\n[9] Switching an existing product between modes converts its stock")
    engine = fresh_db()

    class _FakeUser:
        """convert_product_stock_mode only reads .userId, for the audit row."""
        userId = uuid4()

    with Session(engine) as db:
        # 2450 pieces at 1000/box = 2 sealed boxes + 450 loose.
        product, variant = seed(db, mode="counted", stock=2450, pack=1000.0)
        convert_product_stock_mode(product, "open_container", db, _FakeUser())
        product.unit_stock_mode = "open_container"
        db.commit()
        db.refresh(variant)
        db.refresh(product)

        check("pieces converted to whole packs", variant.stock_quantity == 2,
              f"got {variant.stock_quantity}")
        check("product total re-summed from its variants", product.stock_quantity == 2,
              f"got {product.stock_quantity}")
        containers = db.exec(select(OpenContainer)).all()
        check("the part-box remainder became an already-open pack", len(containers) == 1,
              f"got {len(containers)} container(s)")
        check("carried-over pack starts with a clean tally",
              bool(containers) and containers[0].units_sold == 0.0)
        check("the real leftover figure is preserved in the note",
              bool(containers) and "450" in (containers[0].notes or ""),
              containers[0].notes if containers else "")
        check("its pool key matches what sales will look up",
              bool(containers) and containers[0].pool_key == variant_pool_key(db, product, variant),
              containers[0].pool_key if containers else "")

        # ...and straight back again.
        convert_product_stock_mode(product, "counted", db, _FakeUser())
        product.unit_stock_mode = "counted"
        db.commit()
        db.refresh(variant)
        check("packs converted back to pieces at the nominal size",
              variant.stock_quantity == 2000, f"got {variant.stock_quantity}")
        still_open = db.exec(select(OpenContainer).where(OpenContainer.status == "open")).all()
        check("nothing is left open in counted mode", len(still_open) == 0,
              f"got {len(still_open)} still open")

    print("\n[10] A loose-pieces pool folds into an open pack on switchover")
    engine = fresh_db()
    with Session(engine) as db:
        product, variant = seed(db, mode="counted", stock=2000, pack=1000.0)
        pool_key = variant_pool_key(db, product, variant)
        db.add(Offcut(product_id=product.productId, variant_id=variant.variantId,
                      pool_key=pool_key, length=320, quantity=1, status="available"))
        db.commit()

        convert_product_stock_mode(product, "open_container", db, _FakeUser())
        product.unit_stock_mode = "open_container"
        db.commit()
        db.refresh(variant)
        check("sealed boxes became packs", variant.stock_quantity == 2, f"got {variant.stock_quantity}")
        check("the loose-pieces row is gone", db.exec(select(Offcut)).first() is None)
        containers = db.exec(select(OpenContainer)).all()
        check("loose pieces became one open pack", len(containers) == 1, f"got {len(containers)}")
        check("its note records the 320 loose pieces",
              bool(containers) and "320" in (containers[0].notes or ""),
              containers[0].notes if containers else "")

        # The switched-over product must now sell from that carried-over pack.
        _process_line_items(db, product, variant, [{"type": "accessory-pcs", "qty": 15}])
        db.commit()
        db.refresh(containers[0])
        check("a sub-pack sale dispenses from the carried-over pack",
              containers[0].units_sold == 15.0, f"got {containers[0].units_sold}")

    print("\n[11] Per-pack utilization figures")
    engine = fresh_db()
    with Session(engine) as db:
        product, variant = seed(db)
        container = open_one(db, product, variant)          # labelled 100m
        _process_line_items(db, product, variant, [{"type": "accessory-pcs", "qty": 88}])
        db.commit()
        db.refresh(container)

        util = _utilization(container)
        check("an open pack has a running duration", util["duration_hours"] is not None)
        check("unaccounted is None until someone measures the pack",
              util["unaccounted_units"] is None, str(util["unaccounted_units"]))
        check("variance compares the billed tally against the label",
              util["variance_vs_label"] == -12.0, str(util["variance_vs_label"]))

        # Manager closes it and measures 94m actually came off the roll: 88 was
        # billed, so 6m physically left the pack that no sale recorded.
        container.status = "finished"
        container.actual_quantity = 94.0
        container.closed_at = datetime.now(timezone.utc)
        db.add(container)
        db.commit()
        db.refresh(container)

        util = _utilization(container)
        check("a measured pack exposes the unbilled gap",
              util["unaccounted_units"] == 6.0, str(util["unaccounted_units"]))
        check("variance now uses the measured yield, not the tally",
              util["variance_vs_label"] == -6.0, str(util["variance_vs_label"]))
        check("a closed pack's duration stops at its close time",
              util["duration_hours"] is not None and util["duration_hours"] >= 0)

    print("\n[12] Per-variant utilization rollup")
    engine = fresh_db()
    with Session(engine) as db:
        product, variant = seed(db, stock=5, pack=100.0)

        # Two finished packs, one measured; plus one still open.
        for sold, actual in ((92.0, 95.0), (97.0, None)):
            c = open_one(db, product, variant)
            c.units_sold = sold
            c.actual_quantity = actual
            c.status = "finished"
            c.closed_at = datetime.now(timezone.utc)
            db.add(c)
        still_open = open_one(db, product, variant)
        still_open.units_sold = 40.0
        db.add(still_open)
        db.commit()

        rows = variant_utilization(db)
        check("one row per variant", len(rows) == 1, f"got {len(rows)}")
        row = rows[0]
        check("counts every pack ever opened", row.packs_opened == 3, f"got {row.packs_opened}")
        check("separates finished from still-open",
              row.packs_finished == 2 and row.packs_open_now == 1,
              f"finished={row.packs_finished} open={row.packs_open_now}")
        # Yields: measured 95, and 97 from the tally where nothing was measured.
        check("averages yield over finished packs only", row.avg_yield == 96.0, f"got {row.avg_yield}")
        check("reports yield against the label", row.yield_vs_label_pct == 96.0,
              f"got {row.yield_vs_label_pct}")
        check("says how many packs were actually measured", row.measured_count == 1,
              f"got {row.measured_count}")
        check("totals the unbilled gap across measured packs", row.total_unaccounted == 3.0,
              f"got {row.total_unaccounted}")
        check("totals units sold across every pack, open included",
              row.total_units_sold == 229.0, f"got {row.total_units_sold}")
        check("carries sealed stock still on the shelf", row.sealed_remaining == 5,
              f"got {row.sealed_remaining}")

    print("\n[13] Drill-down: which sales drew from a pack")
    engine = fresh_db()
    with Session(engine) as db:
        product, variant = seed(db)
        cashier = seed_user(db, "amina")
        pack_a = open_one(db, product, variant)

        def sell(customer, qty, total, when_offset_h=0):
            """A real checkout, then the order row the drill-down joins back to."""
            line = {"type": "accessory-pcs", "qty": qty, "total": total}
            _process_line_items(db, product, variant, [line])
            order = Order(
                servedby=cashier, customer_name=customer, subtotal=total, total=total,
                created_at=datetime.now(timezone.utc) + timedelta(hours=when_offset_h),
            )
            db.add(order)
            db.commit()
            db.refresh(order)
            item = OrderItem(
                order_id=order.orderId, product_id=product.productId,
                variant_id=variant.variantId, total_price=total,
                details={"lineItems": [line]}, status="purchased",
            )
            db.add(item)
            db.commit()
            return order

        sell("Joe", 20, 1200, 1)
        sell("Amina", 35, 2100, 2)
        db.commit()

        # A second pack, and a sale off it that must NOT show under pack A.
        db.exec(select(OpenContainer)).all()
        pack_a.status = "finished"
        pack_a.closed_at = datetime.now(timezone.utc)
        db.add(pack_a)
        db.commit()
        pack_b = open_one(db, product, variant)
        sell("Other", 10, 600, 3)
        db.commit()

        usage = container_usage(pack_a.id, db)
        check("only the sales from this pack are listed", len(usage.lines) == 2,
              f"got {len(usage.lines)} line(s)")
        check("units total correctly", usage.total_units == 55.0, f"got {usage.total_units}")
        check("revenue totals correctly", usage.total_revenue == 3300.0, f"got {usage.total_revenue}")
        check("customers are carried through",
              sorted(l.customer_name for l in usage.lines) == ["Amina", "Joe"],
              str([l.customer_name for l in usage.lines]))
        check("lines are ordered oldest first",
              usage.lines[0].customer_name == "Joe", usage.lines[0].customer_name)

        usage_b = container_usage(pack_b.id, db)
        check("the second pack has only its own sale",
              len(usage_b.lines) == 1 and usage_b.total_units == 10.0,
              f"{len(usage_b.lines)} line(s), {usage_b.total_units} units")

        # ...and the rollup's revenue agrees with the drill-down.
        row = variant_utilization(db)[0]
        check("rollup revenue matches the sum of both packs",
              row.total_revenue == 3900.0, f"got {row.total_revenue}")

    print("\n[14] A counted-mode product contributes nothing to the rollup")
    engine = fresh_db()
    with Session(engine) as db:
        seed(db, mode="counted", stock=2000, pack=1000.0)
        check("no packs, no rows", variant_utilization(db) == [])

    print(f"\n{'=' * 60}\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        for f in FAIL:
            print(f"  FAILED: {f}")
        raise SystemExit(1)
    print("All open-container checks passed.")


if __name__ == "__main__":
    run()
