"""
Order-edit matrix — every kind of line, against REAL Postgres.

Runs the real update_order over a throwaway database built from a schema-only dump of the
live one, so FK constraints, enums, SERIAL sequences and JSON columns all behave exactly as
in production. The previous edit tests used SQLite, which needed workarounds (rowid reuse)
and silently skipped the FKs.

Covers the line shapes that actually occur in the live data:

    profile-cut / accessory-cut   1D cut, offcut chain            (40 + 6 live)
    glass-cut                     2D cut, sheet packing           (50 live)
    profile-full / sheet-full     whole units                     (33 + 8 live)
    accessory-unit                packs -> pieces                 (19 live)
    accessory-pcs                 packaged/open-container draw, writes stock_sources
    (no lineItems)                plain details.quantity          (36 live)

and asserts the thing the diff exists for: an item the cart still contains unchanged must
not move ANY stock, keep its cutting status, and keep its consumption record — while a
changed, added or removed item is reversed and rebuilt properly.

SETUP (the harness creates this database; it is dropped and recreated each run):
    psql -U postgres -c "CREATE DATABASE emiratesco_edit_test"
    pg_dump --schema-only --no-owner --no-privileges EmiratesCo_Database | psql -d emiratesco_edit_test

    python test_order_edit_matrix.py
"""
import os
import uuid
from datetime import datetime

from sqlmodel import Session, create_engine, select, text

from config import settings
from entities.attributes import AttributeClass  # noqa: F401 — registers the table
from entities.offcuts import Offcut
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.products import Category, Product
from entities.users import User
from entities.variants import Variant

from core.inventory import reversalPlan as rp
from core.ordering import model, orderService

TEST_DB = os.getenv("EDIT_TEST_DB", "emiratesco_edit_test")
FULL_BAR = 6.0
SHEET_W, SHEET_H = 2440.0, 1830.0

failures = []
_next_order_id = [9000]


def check(label, got, want):
    ok = got == want
    print(f"    [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    if not ok:
        failures.append(label)


def engine_for_test_db():
    url = settings.get_database_url()
    base, _, _ = url.rpartition("/")
    return create_engine(f"{base}/{TEST_DB}", echo=False)


class FakeUser:
    def __init__(self, user_id):
        self.userId = user_id
        self.role = "manager"
        self.username = "edit-matrix"


# ── Seeding ───────────────────────────────────────────────────────────────────

def reset(db):
    """Clear everything this suite writes. The test database is a throwaway, but it
    persists between runs, so the fixed order ids would collide on a second run."""
    db.exec(text(
        "TRUNCATE offcut_piece_events, offcut_pieces, offcuts, orderitems, edit_history, "
        "payments, credits, orders, variants, products, categories RESTART IDENTITY CASCADE"
    ))
    db.commit()


def rebaseline(db):
    """Start the integrity check's stock-vs-journal comparison from the stock as it is NOW.

    Call it after a suite has reset the journal and seeded its products. stock_baseline is
    shared by every suite on this database, and a baseline left by another suite (or taken
    when different products existed) makes the check compare today's stock with someone
    else's numbers - "stock is 39 but baseline + journal says 3". With no stock rows yet a
    sentinel row is written instead: the check runs only when the baseline table is non-empty,
    and every product inserted afterwards is journaled from its insert."""
    db.exec(text("DELETE FROM stock_baseline"))
    last = db.exec(text("SELECT coalesce(max(id), 0) FROM stock_journal")).one()[0]
    taken = 0
    for table, col in (("variants", '"variantId"'), ("products", '"productId"')):
        taken += db.exec(text(
            f"INSERT INTO stock_baseline (table_name, row_pk, quantity, taken_at, after_journal_id) "
            f"SELECT '{table}', {col}::text, coalesce(stock_quantity, 0), now() at time zone 'utc', :last "
            f"FROM {table}").bindparams(last=last)).rowcount
    if not taken:
        db.exec(text("INSERT INTO stock_baseline (table_name, row_pk, quantity, taken_at, after_journal_id) "
                     "VALUES ('variants', '0', 0, now() at time zone 'utc', :last)").bindparams(last=last))
    db.commit()
    return last


def seed_base(db):
    cat = db.exec(select(Category)).first()
    if cat is None:
        # `type` is NOT NULL and drives category behaviour elsewhere; real rows use slugs
        # like "ke-profile" / "glass".
        cat = Category(name="Test Category", type="ke-profile", sub_categories=[])
        db.add(cat)
        db.flush()

    user = db.exec(select(User)).first()
    if user is None:
        user = User(userId=uuid.uuid4(), firstName="Edit", secondName="Matrix",
                    phoneNumber="0700000000", role="manager", email="edit@test.local",
                    username="edit-matrix", password="x", mustChangePassword=False,
                    isActive=True)
        db.add(user)
        db.flush()
    return cat, user


def seed_product(db, cat, name, *, kind):
    """kind: 'bar' (1D cuts), 'glass' (2D), 'simple' (whole units only)."""
    product = Product(
        name=name, category_id=cat.categoryId, stock_quantity=40,
        track_offcuts=kind in ("bar", "glass"),
        has_variants=True, has_dimensions=(kind == "glass"),
        unit="ft" if kind == "bar" else "pcs",
    )
    db.add(product)
    db.flush()
    if kind == "glass":
        variant = Variant(product_id=product.productId, name="", attributes={},
                          stock_quantity=40, price=100.0, price_unit=12.0, price_half=60.0,
                          length=SHEET_W, width=SHEET_H, min_usable=200.0)
    else:
        variant = Variant(product_id=product.productId, name="", attributes={},
                          stock_quantity=40, price=100.0, price_unit=50.0, price_half=60.0,
                          length=FULL_BAR if kind == "bar" else None,
                          min_usable=0.4 if kind == "bar" else None,
                          unit_quantity=10 if kind == "simple" else None)
    db.add(variant)
    db.flush()
    return product, variant


def new_order(db, user):
    _next_order_id[0] += 1
    order = Order(orderId=_next_order_id[0], servedby=user.userId,
                  customer_name="Edit Matrix", subtotal=0, total=0,
                  amountPayed=0, balance=0, status="confirmed", payment_status="Unpaid")
    db.add(order)
    db.flush()
    return order


# ── Line shapes ───────────────────────────────────────────────────────────────

def line_cut_1d(length, qty=1):
    return {"type": "profile-cut", "qty": qty, "meta": {"length": length},
            "label": f"{length}ft cut", "rate": 50.0, "total": 50.0 * length * qty}


def line_cut_2d(w, h, qty=1):
    area = round((w / 304.8) * (h / 304.8), 3)
    return {"type": "glass-cut", "qty": qty,
            "meta": {"l": w, "w": h, "u": "mm", "area": area},
            "label": f"{w}x{h}mm", "rate": 12.0, "total": round(12.0 * area * qty, 2)}


def line_full(qty=1):
    return {"type": "profile-full", "qty": qty, "meta": {},
            "label": "full bar", "rate": 100.0, "total": 100.0 * qty}


def line_unit(qty=1):
    return {"type": "accessory-unit", "qty": qty, "meta": {},
            "label": "pack", "rate": 100.0, "total": 100.0 * qty}


def add_item(db, order, product, variant, lines, *, qty=1, price=500.0, unit="pcs"):
    details = {"lineItems": lines, "quantity": qty, "unitType": unit, "unitPrice": price}
    item = OrderItem(order_id=order.orderId, product_id=product.productId,
                     variant_id=variant.variantId, total_price=price,
                     status="purchased", details=details)
    db.add(item)
    db.flush()
    from core.inventory.inventoryService import deduct_stock_for_order_item
    deduct_stock_for_order_item(db, item)
    db.flush()
    return item


def simple_item(db, order, product, variant, qty, price=500.0):
    """An item with NO lineItems — 36 live items look like this."""
    item = OrderItem(order_id=order.orderId, product_id=product.productId,
                     variant_id=variant.variantId, total_price=price, status="purchased",
                     details={"quantity": qty, "unitType": "pcs", "unitPrice": price})
    db.add(item)
    db.flush()
    from core.inventory.inventoryService import deduct_stock_for_order_item
    deduct_stock_for_order_item(db, item)
    db.flush()
    return item


def req_from_item(item, *, price=None, quantity=None, lines=None):
    """The payload OrderContext.mapItemForBackend produces — details round-tripped from the
    loaded order, engine-written keys and all."""
    d = dict(item.details or {})
    if lines is not None:
        d["lineItems"] = lines
    q = quantity if quantity is not None else d.get("quantity", 1)
    d["quantity"] = q
    return model.OrderItemRequest(
        productId=item.product_id, variantId=item.variant_id, quantity=q,
        unitPrice=price if price is not None else d.get("unitPrice", 0),
        unitType=d.get("unitType", "pcs"), details=d)


def edit(db, order, user, items, confirmations=None):
    return orderService.update_order(
        order.orderId,
        model.OrderEditRequest(
            customerId=None, customerName="Edit Matrix", amountPaid=0.0,
            servedBy=user.userId, VAT_status=False, discount=0.0,
            paymentStatus="Unpaid", items=items, cutConfirmations=confirmations),
        db, FakeUser(user.userId))


def stock_of(db, variant):
    db.refresh(variant)
    return variant.stock_quantity


def pool_of(db, product):
    rows = db.exec(select(Offcut).where(Offcut.product_id == product.productId,
                                       Offcut.quantity > 0)).all()
    return sorted((round(r.length, 3), round(r.width or 0, 1), round(r.height or 0, 1), r.quantity)
                  for r in rows)


def items_of(db, order):
    return {i.item_id: i for i in
            db.exec(select(OrderItem).where(OrderItem.order_id == order.orderId)).all()}


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_full_products_untouched(db, cat, user):
    """A whole-unit item the cart still contains must not move a single unit of stock."""
    print("\n--- 1. Whole-unit (profile-full) items ---")
    prod, var = seed_product(db, cat, "Matrix Full Bar", kind="bar")
    other, ovar = seed_product(db, cat, "Matrix Other Bar", kind="bar")
    order = new_order(db, user)

    full = add_item(db, order, prod, var, [line_full(3)])
    changed = add_item(db, order, other, ovar, [line_full(2)])
    db.commit()

    s_full, s_changed = stock_of(db, var), stock_of(db, ovar)
    check("3 whole units were deducted", s_full, 37)

    edit(db, order, user, [req_from_item(full), req_from_item(changed, lines=[line_full(5)])])

    check("untouched full item moved no stock", stock_of(db, var), s_full)
    check("its row survived", full.item_id in items_of(db, order), True)
    check("changed full item deducted the delta", stock_of(db, ovar), s_changed + 2 - 5)


def test_simple_items(db, cat, user):
    """Items with no lineItems at all — a plain details.quantity deduction."""
    print("\n--- 2. Plain-quantity items (no lineItems) ---")
    prod, var = seed_product(db, cat, "Matrix Simple", kind="simple")
    keep, kvar = seed_product(db, cat, "Matrix Simple Keep", kind="simple")
    order = new_order(db, user)

    kept = simple_item(db, order, keep, kvar, 4)
    moved = simple_item(db, order, prod, var, 6)
    db.commit()

    s_keep, s_move = stock_of(db, kvar), stock_of(db, var)
    check("plain quantity was deducted", s_move, 34)

    edit(db, order, user, [req_from_item(kept), req_from_item(moved, quantity=2)])

    check("untouched plain item moved no stock", stock_of(db, kvar), s_keep)
    check("changed plain item re-deducted correctly", stock_of(db, var), s_move + 6 - 2)
    check("untouched row survived", kept.item_id in items_of(db, order), True)


def test_accessory_units(db, cat, user):
    """accessory-unit multiplies by the variant's pieces-per-pack."""
    print("\n--- 3. accessory-unit (packs -> pieces) ---")
    prod, var = seed_product(db, cat, "Matrix Accessory", kind="simple")
    order = new_order(db, user)
    item = add_item(db, order, prod, var, [line_unit(2)])
    db.commit()
    before = stock_of(db, var)

    edit(db, order, user, [req_from_item(item)])
    check("an untouched accessory-unit item moved no stock", stock_of(db, var), before)

    edit(db, order, user, [req_from_item(item, lines=[line_unit(3)])])
    check("changing it re-deducted one more pack's worth",
          stock_of(db, var), before - 10)


def test_mixed_full_and_cut(db, cat, user):
    """The case that prompted all this: full products + cuts in one order, edit one."""
    print("\n--- 4. Mixed order: whole units + 1D cut + 2D cut ---")
    bar, bvar = seed_product(db, cat, "Matrix Mixed Bar", kind="bar")
    glass, gvar = seed_product(db, cat, "Matrix Mixed Glass", kind="glass")
    plain, pvar = seed_product(db, cat, "Matrix Mixed Full", kind="bar")
    order = new_order(db, user)

    cut_item = add_item(db, order, bar, bvar, [line_cut_1d(1.8)])
    glass_item = add_item(db, order, glass, gvar, [line_cut_2d(1200, 900)])
    full_item = add_item(db, order, plain, pvar, [line_full(2)])

    for it in (cut_item, glass_item):
        it.cutting_completed = True
        it.cutting_completed_at = datetime.utcnow()
        db.add(it)
    db.commit()

    bar_stock, glass_stock, full_stock = stock_of(db, bvar), stock_of(db, gvar), stock_of(db, pvar)
    bar_pool, glass_pool = pool_of(db, bar), pool_of(db, glass)
    cut_sources = cut_item.details["lineItems"][0]["offcut_sources"]

    # Only the 1D cut changes.
    plan = orderService.get_reversal_plan(
        order.orderId, db, FakeUser(user.userId),
        incoming_items=[req_from_item(cut_item, lines=[line_cut_1d(2.4)]),
                        req_from_item(glass_item), req_from_item(full_item)])
    reversing = [l["item_id"] for l in plan["lines"] if l["will_reverse"]]
    check("only the 1D cut line is in scope", reversing, [cut_item.item_id])
    check("the glass line is listed but not reversing",
          [l["will_reverse"] for l in plan["lines"] if l["item_id"] == glass_item.item_id], [False])
    check("only one line needs an answer",
          sum(1 for l in plan["lines"] if l["requires_explicit_answer"]), 1)

    ref = next(l["line_ref"] for l in plan["lines"] if l["item_id"] == cut_item.item_id)
    edit(db, order, user,
         [req_from_item(cut_item, lines=[line_cut_1d(2.4)]),
          req_from_item(glass_item), req_from_item(full_item)],
         confirmations={ref: {"physicalState": rp.PHYS_ALREADY_CUT,
                              "resolution": rp.RES_RETURN_TO_POOL}})

    survivors = items_of(db, order)
    check("the glass item survived untouched", glass_item.item_id in survivors, True)
    check("and is still marked cut", survivors[glass_item.item_id].cutting_completed, True)
    check("the glass pool is unchanged", pool_of(db, glass), glass_pool)
    check("glass stock is unchanged", stock_of(db, gvar), glass_stock)
    check("the whole-unit item survived", full_item.item_id in survivors, True)
    check("its stock is unchanged", stock_of(db, pvar), full_stock)
    check("the 1D cut item was replaced", cut_item.item_id in survivors, False)
    check("the 1D pool did change", pool_of(db, bar) != bar_pool, True)
    check("the replacement needs cutting",
          [i.cutting_completed for k, i in survivors.items()
           if i.product_id == bar.productId], [False])
    check("the surviving glass item kept its consumption record",
          bool(survivors[glass_item.item_id].details["lineItems"][0].get("offcut_sources")), True)
    check("the old 1D sources are gone from the order",
          any(i.details["lineItems"][0].get("offcut_sources") == cut_sources
              for i in survivors.values()), False)


def test_add_and_remove(db, cat, user):
    """Adding and removing items, with an untouched neighbour in between."""
    print("\n--- 5. Adding and removing items ---")
    keep, kvar = seed_product(db, cat, "Matrix AddRem Keep", kind="bar")
    drop, dvar = seed_product(db, cat, "Matrix AddRem Drop", kind="bar")
    add, avar = seed_product(db, cat, "Matrix AddRem Add", kind="bar")
    order = new_order(db, user)

    kept = add_item(db, order, keep, kvar, [line_cut_1d(1.5)])
    doomed = add_item(db, order, drop, dvar, [line_full(2)])
    db.commit()

    k_stock, k_pool = stock_of(db, kvar), pool_of(db, keep)
    d_stock, a_stock = stock_of(db, dvar), stock_of(db, avar)

    new_req = model.OrderItemRequest(
        productId=add.productId, variantId=avar.variantId, quantity=1,
        unitPrice=300.0, unitType="pcs",
        details={"lineItems": [line_full(3)], "quantity": 1,
                 "unitType": "pcs", "unitPrice": 300.0})

    edit(db, order, user, [req_from_item(kept), new_req])

    survivors = items_of(db, order)
    check("the untouched cut item survived", kept.item_id in survivors, True)
    check("its stock is unchanged", stock_of(db, kvar), k_stock)
    check("its offcut pool is unchanged", pool_of(db, keep), k_pool)
    check("the removed item is gone", doomed.item_id in survivors, False)
    check("and its whole units came back", stock_of(db, dvar), d_stock + 2)
    check("the added item deducted its units", stock_of(db, avar), a_stock - 3)
    check("the order now has two items", len(survivors), 2)


def test_engine_written_keys_ignored(db, cat, user):
    """A cart whose lines LACK the engine-written keys must still match — that is the
    frontend rebuilding a line, or a manager correction having rewritten the stored copy
    while the order was open."""
    print("\n--- 6. Engine-written keys don't make a line look changed ---")
    prod, var = seed_product(db, cat, "Matrix Keys", kind="bar")
    order = new_order(db, user)
    item = add_item(db, order, prod, var, [line_cut_1d(2.0)])
    db.commit()

    stored = item.details["lineItems"][0]
    check("the engine wrote offcut_sources onto the stored line",
          "offcut_sources" in stored, True)

    before_stock, before_pool = stock_of(db, var), pool_of(db, prod)
    # Rebuild the line the way a calculator would: identical cut, no offcut_sources.
    rebuilt = line_cut_1d(2.0)
    assert "offcut_sources" not in rebuilt
    edit(db, order, user, [req_from_item(item, lines=[rebuilt])])

    survivors = items_of(db, order)
    check("the item was matched as unchanged", item.item_id in survivors, True)
    check("no stock moved", stock_of(db, var), before_stock)
    check("the offcut pool is unchanged", pool_of(db, prod), before_pool)
    check("its consumption record survived",
          bool(survivors[item.item_id].details["lineItems"][0].get("offcut_sources")), True)

    # A tariff change rewrites rate/total on the line. That is money, not material.
    repriced = {**line_cut_1d(2.0), "rate": 75.0, "total": 150.0, "label": "2ft @ 75"}
    edit(db, order, user, [req_from_item(item, lines=[repriced])])
    survivors = items_of(db, order)
    check("a line-level price change is not a material change",
          item.item_id in survivors, True)
    check("and still moves no stock", stock_of(db, var), before_stock)
    check("nor any offcuts", pool_of(db, prod), before_pool)


def test_quantity_and_price(db, cat, user):
    """A price field in the request is not a change; quantity is.

    An untouched item keeps the price it was SOLD at (since 2026-09-30 - it used to be
    repriced from today's price list on every edit, silently changing what the customer owed
    for items nobody touched). A client-submitted unitPrice is never trusted either way.
    """
    print("\n--- 7. Price vs quantity ---")
    prod, var = seed_product(db, cat, "Matrix Price", kind="bar")
    order = new_order(db, user)
    item = add_item(db, order, prod, var, [line_cut_1d(1.2)], price=400.0)
    db.commit()
    before_stock, before_pool = stock_of(db, var), pool_of(db, prod)

    edit(db, order, user, [req_from_item(item)])
    survivors = items_of(db, order)
    priced_from_db = survivors[item.item_id].total_price
    check("the row survives an edit that changes nothing", item.item_id in survivors, True)
    check("an untouched item keeps the price it was sold at", priced_from_db, 400.0)

    edit(db, order, user, [req_from_item(item, price=999.0)])
    survivors = items_of(db, order)
    check("a submitted price keeps the row", item.item_id in survivors, True)
    check("moves no stock", stock_of(db, var), before_stock)
    check("moves no offcuts", pool_of(db, prod), before_pool)
    check("and is ignored in favour of the DB price",
          survivors[item.item_id].total_price, priced_from_db)

    edit(db, order, user, [req_from_item(item, quantity=3)])
    check("a quantity change replaces the row",
          item.item_id in items_of(db, order), False)


def test_cart_order_survives_a_partial_edit(db, cat, user):
    """An order must keep reporting its items in CART order after a partial edit.

    Callers match the order back to the cart array POSITIONALLY -- the printed cutting
    worksheet (client ReceiptPage) merges the cart snapshot with the saved order by index.
    That held while item_id order was cart order, which stopped being true when update_order
    became a diff: kept items keep their original low ids, changed ones are appended with
    new high ids, so a kept item can sort ahead of one that precedes it in the cart.

    The live symptom (order #190) was a worksheet printing the GLASS cutting instructions
    under a PROFILE item and the profile instructions under the glass item. Reproduced here:
    cart [A, C, B] with A and B kept and C edited, which leaves item_ids out of order.
    """
    print()
    print("--- 8. Cart order survives a partial edit ---")
    a_prod, a_var = seed_product(db, cat, "Order AAA", kind="bar")
    c_prod, c_var = seed_product(db, cat, "Order CCC Glass", kind="glass")
    b_prod, b_var = seed_product(db, cat, "Order BBB", kind="bar")
    order = new_order(db, user)

    a = add_item(db, order, a_prod, a_var, [line_full(1)])
    c = add_item(db, order, c_prod, c_var, [line_cut_2d(1200, 900)])
    b = add_item(db, order, b_prod, b_var, [line_cut_1d(4.0)])
    db.commit()

    # Edit ONLY the middle (glass) item; cart order is unchanged.
    edit(db, order, user, [req_from_item(a),
                           req_from_item(c, lines=[line_cut_2d(1100, 800)]),
                           req_from_item(b)])

    resp = orderService.get_order_by_orderId(order.orderId, db)
    names = [db.get(Product, it.productId).name for it in resp.items]
    ids = [it.itemId for it in resp.items]

    check("items are reported in cart order",
          names, ["Order AAA", "Order CCC Glass", "Order BBB"])
    check("the kept items held their original ids", [ids[0], ids[2]], [a.item_id, b.item_id])
    check("the edited item is a new row", ids[1] != c.item_id, True)
    # The regression guard: if this ever sorts ascending again the test has stopped
    # exercising the case it exists for.
    check("item_id order alone would have been wrong here", sorted(ids) != ids, True)

    def instruction_types(item):
        return {l.get("type") for l in (item.details or {}).get("lineItems") or []
                if l.get("offcut_sources")}

    check("the glass item carries glass instructions",
          instruction_types(resp.items[names.index("Order CCC Glass")]), {"glass-cut"})
    check("the profile item carries profile instructions",
          instruction_types(resp.items[names.index("Order BBB")]), {"profile-cut"})


# ── Regression tests for bugs found by the live audit ─────────────────────────

def test_untouched_unknown_line_does_not_block(db, cat, user):
    """An untouched cut line whose status is UNKNOWN (cutting_completed TRUE with no
    timestamp — every item made before cutting tracking) used to REFUSE the whole edit,
    though nothing was asked of it: validate_decisions evaluated its default anyway."""
    print("\n--- 9. An untouched UNKNOWN cut line doesn't block an edit ---")
    bar, bvar = seed_product(db, cat, "Reg Unknown Bar", kind="bar")
    other, ovar = seed_product(db, cat, "Reg Unknown Other", kind="bar")
    order = new_order(db, user)
    kept = add_item(db, order, bar, bvar, [line_cut_1d(1.5)])
    touched = add_item(db, order, other, ovar, [line_full(1)])
    kept.cutting_completed, kept.cutting_completed_at = True, None
    db.add(kept)
    db.commit()
    check("the untouched line really does default to UNKNOWN",
          rp.default_physical_state(kept), rp.PHYS_UNKNOWN)
    try:
        edit(db, order, user, [req_from_item(kept), req_from_item(touched, lines=[line_full(2)])])
        check("the edit goes through", True, True)
    except Exception as e:
        check("the edit goes through", getattr(e, "detail", str(e)), True)
    check("the untouched item survived", kept.item_id in items_of(db, order), True)


def test_lifo_within_one_line(db, cat, user):
    """qty 2 of 1.8 off a 6.0 bar: the second cut is cut FROM the first one's 4.2
    remainder. Undone in the order they were made, the first cut found its remainder still
    held by the second, and an UNCUT bar came back as two offcuts. Undone last-first, the
    whole bar returns to stock."""
    print("\n--- 10. Undo is last-in-first-out within a line ---")
    bar, bvar = seed_product(db, cat, "Reg LIFO Bar", kind="bar")
    order = new_order(db, user)
    start = stock_of(db, bvar)
    item = add_item(db, order, bar, bvar, [line_cut_1d(1.8, qty=2)])
    db.commit()
    kinds = [s["source"] for s in item.details["lineItems"][0]["offcut_sources"]]
    check("the second cut really was taken from the first one's remainder",
          kinds, ["full_bar", "offcut"])
    plan = rp.build_plan(db, order)
    decisions = rp.validate_decisions(plan, {plan["lines"][0]["line_ref"]:
                                             {"physicalState": rp.PHYS_NOT_CUT}})
    orderService._restore_and_cancel(db, order, None, cut_decisions=decisions)
    db.commit()
    check("the uncut bar goes back to stock whole", stock_of(db, bvar), start)
    check("and leaves no offcuts behind", pool_of(db, bar), [])


def test_lifo_across_items(db, cat, user):
    """Same trap one level up: a LATER item cut from an EARLIER item's remainder, both on
    one order. Items are reversed newest first."""
    print("\n--- 11. Undo is last-in-first-out across items ---")
    bar, bvar = seed_product(db, cat, "Reg LIFO Items Bar", kind="bar")
    order = new_order(db, user)
    start = stock_of(db, bvar)
    add_item(db, order, bar, bvar, [line_cut_1d(1.8)])
    later = add_item(db, order, bar, bvar, [line_cut_1d(2.0)])
    db.commit()
    check("the later item really was cut from the earlier one's remainder",
          later.details["lineItems"][0]["offcut_sources"][0]["source"], "offcut")
    plan = rp.build_plan(db, order)
    decisions = rp.validate_decisions(plan, {l["line_ref"]: {"physicalState": rp.PHYS_NOT_CUT}
                                             for l in plan["lines"]})
    orderService._restore_and_cancel(db, order, None, cut_decisions=decisions)
    db.commit()
    check("the uncut bar goes back to stock whole", stock_of(db, bvar), start)
    check("and leaves no offcuts behind", pool_of(db, bar), [])


def test_stale_manual_offcut_pick(db, cat, user):
    """A cashier's manual offcut pick names a pooled row by id. When the cut used that
    offcut up, the row was deleted; an edit that re-cuts the line first puts the material
    back as a NEW row, so re-cutting with the stored id failed the whole edit with
    "Offcut #N no longer exists". Pre-existing — and the old teardown hit it on ANY edit of
    such an order. The pick is now followed through the ledger to the same physical piece."""
    print("\n--- 12. A used-up manual offcut pick survives a re-cut ---")
    bar, bvar = seed_product(db, cat, "Reg Pick Bar", kind="bar")
    from core.inventory import offcutLedger as ledger
    row = Offcut(product_id=bar.productId, variant_id=bvar.variantId, pool_key="",
                 length=4.0, quantity=1, status="available")
    db.add(row)
    db.flush()
    ledger.mint_pieces_for_row(db, row, origin=ledger.ORIGIN_MANUAL_ENTRY, notes="test")
    db.commit()
    picked_row = row.offcutId

    order = new_order(db, user)
    line = {**line_cut_1d(1.5), "offcut_selection": [{"offcut_id": picked_row, "length_used": 1.5}]}
    item = add_item(db, order, bar, bvar, [line])
    db.commit()
    first = item.details["lineItems"][0]["offcut_sources"][0]
    check("the pick consumed the chosen offcut", first["offcut_id"], picked_row)
    check("which used it up, deleting the row", db.get(Offcut, picked_row), None)

    plan = orderService.get_reversal_plan(
        order.orderId, db, FakeUser(user.userId),
        incoming_items=[req_from_item(item, quantity=2)])
    answers = {l["line_ref"]: {"physicalState": rp.PHYS_NOT_CUT}
               for l in plan["lines"] if l["will_reverse"]}
    try:
        edit(db, order, user, [req_from_item(item, quantity=2)], confirmations=answers)
        check("the edit re-cuts without failing", True, True)
    except Exception as e:
        check("the edit re-cuts without failing", getattr(e, "detail", str(e)), True)
        return
    new_item = next(iter(items_of(db, order).values()))
    again = new_item.details["lineItems"][0]["offcut_sources"][0]
    check("it still cut from an offcut, not a fresh bar", again["source"], "offcut")
    check("the very same physical piece", again["source_piece_id"], first["source_piece_id"])


def test_fingerprint_ignores_untouched_chains(db, cat, user):
    """The plan token used to fingerprint every cut line, so another sale using an offcut
    from an UNTOUCHED item's chain forced a pointless re-confirmation. It now covers only
    lines the edit reverses — and still catches movement on those."""
    print("\n--- 13. The plan token only watches material that moves ---")
    kept_bar, kvar = seed_product(db, cat, "Reg Token Kept", kind="bar")
    edit_bar, evar = seed_product(db, cat, "Reg Token Edited", kind="bar")
    order = new_order(db, user)
    kept = add_item(db, order, kept_bar, kvar, [line_cut_1d(1.5)])
    edited = add_item(db, order, edit_bar, evar, [line_cut_1d(1.5)])
    db.commit()
    cart = [req_from_item(kept), req_from_item(edited, quantity=2)]
    token = orderService.get_reversal_plan(order.orderId, db, FakeUser(user.userId),
                                           incoming_items=cart)["plan_token"]

    def still_fresh():
        plan = orderService.get_reversal_plan(order.orderId, db, FakeUser(user.userId),
                                              incoming_items=cart)
        try:
            rp.assert_plan_fresh(db, rp.build_plan(
                db, order, reversing_item_ids={l["item_id"] for l in plan["lines"]
                                               if l["will_reverse"]}), token)
            return True
        except rp.PlanStaleError as e:
            check("a stale plan comes back without internal fields",
                  any("_piece_ids" in l for l in e.fresh_plan["lines"]), False)
            return False

    # Another sale cuts into the UNTOUCHED item's remainder.
    other = new_order(db, user)
    add_item(db, other, kept_bar, kvar, [line_cut_1d(1.0)])
    db.commit()
    check("movement in an untouched item's chain does not invalidate the token",
          still_fresh(), True)

    # Another sale cuts into the EDITED item's remainder.
    add_item(db, other, edit_bar, evar, [line_cut_1d(1.0)])
    db.commit()
    check("movement in the edited item's chain still does", still_fresh(), False)


def test_order_age_uses_local_clock(db, cat, user):
    """orders.created_at holds Nairobi local time; the cancel window used to subtract it
    from UTC, making every order look three hours younger (a fresh order came out at
    minus 2h 43m)."""
    print("\n--- 14. Order age is measured on the database's own clock ---")
    order = new_order(db, user)
    db.commit()
    db.refresh(order)
    age = orderService._order_age(db, order)
    check("a just-placed order is not negative-aged", age.total_seconds() >= 0, True)
    check("and is only seconds old", age.total_seconds() < 120, True)


def _shared_sheet_order(db, cat, user, name):
    """One glass item whose two lines _apply_candidate packs onto ONE sheet."""
    g, gv = seed_product(db, cat, name, kind="glass")
    order = new_order(db, user)
    item = add_item(db, order, g, gv, [line_cut_2d(540, 1020, qty=2), line_cut_2d(550, 1100, qty=2)])
    db.commit()
    groups = {s.get("group_id") for l in item.details["lineItems"] for s in l["offcut_sources"]}
    return g, gv, order, item, groups


def _pool_area(db, product):
    return sum(w * h * q for _, w, h, q in pool_of(db, product))


def test_shared_sheet_is_cut_if_any_line_is(db, cat, user):
    """Two lines on one sheet, answered differently. Order 201 (5mm O/w Blue): the sharing
    line said "already cut", the owning line said "not cut" — the sharer was skipped and
    the owner put the WHOLE sheet back in stock, though two pieces had been cut out of it."""
    print("\n--- 15. A sheet is cut if any line on it is cut ---")
    g, gv, order, item, groups = _shared_sheet_order(db, cat, user, "Reg Shared Mixed")
    check("both lines really share one sheet", len(groups), 1)
    plan = rp.build_plan(db, order)
    check("the plan puts both lines in one sheet group",
          len({l["sheet_group"] for l in plan["lines"]} - {None}), 1)
    answers = {plan["lines"][0]["line_ref"]: {"physicalState": rp.PHYS_ALREADY_CUT,
                                              "resolution": rp.RES_RETURN_TO_POOL},
               plan["lines"][1]["line_ref"]: {"physicalState": rp.PHYS_NOT_CUT}}
    start = stock_of(db, gv)
    orderService._restore_and_cancel(db, order, None, cut_decisions=rp.validate_decisions(plan, answers))
    db.commit()
    check("no sheet is put back in stock", stock_of(db, gv), start)
    check("the whole sheet's area is accounted for in the pool",
          round(_pool_area(db, g)), round(SHEET_W * SHEET_H))


def test_shared_sheet_all_cut_keeps_every_piece(db, cat, user):
    """Every line on the sheet cut: only the OWNING line's pieces used to be credited, so the
    sharing line's pieces (2 x 540x1020 here) vanished from the books."""
    print("\n--- 16. Every piece on a cut shared sheet is kept ---")
    g, gv, order, item, _ = _shared_sheet_order(db, cat, user, "Reg Shared All")
    plan = rp.build_plan(db, order)
    answers = {l["line_ref"]: {"physicalState": rp.PHYS_ALREADY_CUT,
                               "resolution": rp.RES_RETURN_TO_POOL} for l in plan["lines"]}
    start = stock_of(db, gv)
    orderService._restore_and_cancel(db, order, None, cut_decisions=rp.validate_decisions(plan, answers))
    db.commit()
    check("no sheet is put back in stock", stock_of(db, gv), start)
    check("the whole sheet's area is accounted for in the pool",
          round(_pool_area(db, g)), round(SHEET_W * SHEET_H))
    # Either orientation: the packer may have rotated them.
    pieces = [frozenset((w, h)) for _, w, h, q in pool_of(db, g) for _ in range(q)]
    check("including both sharing-line pieces (540x1020)",
          pieces.count(frozenset((540.0, 1020.0))), 2)


def test_legacy_already_cut_is_honoured(db, cat, user):
    """On a cut recorded before the ledger, "already cut" used to be IGNORED: the legacy
    size-matching path ran instead and put a whole bar / sheet back in stock."""
    print("\n--- 17. 'Already cut' is honoured on cuts with no ledger history ---")
    from sqlalchemy.orm.attributes import flag_modified
    for kind, line, label in (("bar", line_cut_1d(1.8), "bar"), ("glass", line_cut_2d(1200, 900), "sheet")):
        p, v = seed_product(db, cat, f"Reg Legacy {label}", kind=kind)
        order = new_order(db, user)
        item = add_item(db, order, p, v, [line])
        details = dict(item.details)
        for l in details["lineItems"]:
            for src in l.get("offcut_sources") or []:
                src.pop("source_piece_id", None)
                src.pop("remainder_piece_id", None)
                for r in src.get("remainders_created") or []:
                    r.pop("piece_id", None)
        item.details = details
        flag_modified(item, "details")
        db.add(item)
        db.commit()
        plan = rp.build_plan(db, order)
        check(f"the {label} cut really has no ledger history", plan["lines"][0]["legacy"], True)
        start = stock_of(db, v)
        answers = {plan["lines"][0]["line_ref"]: {"physicalState": rp.PHYS_ALREADY_CUT,
                                                  "resolution": rp.RES_RETURN_TO_POOL}}
        orderService._restore_and_cancel(db, order, None, cut_decisions=rp.validate_decisions(plan, answers))
        db.commit()
        check(f"no {label} is put back in stock", stock_of(db, v), start)


def test_plan_labels_and_tree(db, cat, user):
    """What the operator is shown: a half-bar line said "1 x 19ft" (the bar's length), and
    the material history was drawn with children under the wrong parent."""
    print("\n--- 18. The plan labels halves and draws the history as a tree ---")
    p, v = seed_product(db, cat, "Reg Labels Bar", kind="bar")
    order = new_order(db, user)
    add_item(db, order, p, v, [{"type": "profile-half", "qty": 1, "meta": {"length": "6ft"},
                                "label": "half", "rate": 60.0, "total": 60.0}])
    add_item(db, order, p, v, [line_cut_1d(1.0)])   # cut from the half's remainder
    db.commit()
    plan = rp.build_plan(db, order)
    half = next(l for l in plan["lines"] if l["line_type"] == "profile-half")
    check("a half line says it is a half, with the length cut", half["cut_description"], "1 x half bar (3.00)")
    pieces = half["chain"]["pieces"]
    ok = all(i == 0 or pieces[i]["parent_piece_id"] in {q["piece_id"] for q in pieces[:i]}
             for i in range(len(pieces)))
    check("every piece in the history follows its own parent", ok, True)


def test_calculator_check_during_edit(db, cat, user):
    """Re-opening a cut in the calculator during an edit re-checks it against current stock.
    If this very order had used its hand-picked offcut up, that offcut no longer existed, so
    the check said "Offcut #N no longer exists" and disabled Add to Order — though saving
    would have worked. With the order being edited named, the dry run gives that order's
    material back first, as the edit does. A new sale keeps the strict check."""
    print("\n--- 19. The calculator's stock check understands an edit ---")
    from core.inventory import offcutLedger as ledger
    from core.inventory.inventoryService import check_line_items_feasible

    bar, bvar = seed_product(db, cat, "Reg Calc Bar", kind="bar")
    row = Offcut(product_id=bar.productId, variant_id=bvar.variantId, pool_key="",
                 length=4.0, quantity=1, status="available")
    db.add(row)
    db.flush()
    ledger.mint_pieces_for_row(db, row, origin=ledger.ORIGIN_MANUAL_ENTRY, notes="test")
    db.commit()
    picked = row.offcutId

    order = new_order(db, user)
    line = {**line_cut_1d(4.0), "offcut_selection": [{"offcut_id": picked, "length_used": 4.0}]}
    add_item(db, order, bar, bvar, [line])
    db.commit()
    check("the pick used the offcut up", db.get(Offcut, picked), None)

    as_sent = [{k: v for k, v in line.items() if k != "offcut_sources"}]
    strict = check_line_items_feasible(db, bar, bvar, as_sent)
    check("a NEW sale is still told the offcut is gone", strict["ok"], False)
    edit_aware = check_line_items_feasible(db, bar, bvar, as_sent, edit_order_id=order.orderId)
    check("the same cut inside an edit of that order is fine", edit_aware["ok"], True)
    check("and the dry run left the order's consumption untouched",
          bool(items_of(db, order)), True)
    check("nor brought the offcut back", db.get(Offcut, picked), None)


def test_history_shows_only_the_lines_lineage(db, cat, user):
    """The material history used to draw every piece ever cut from the root sheet — 14 rows
    for a 2-piece line on order 202. It now shows only this line's lineage.

    Needs a BRANCH to mean anything: a sheet leaves two remainders, and two different orders
    each cut from one of them. Each order's history must show its own branch and not the
    other's (a straight bar chain has no branches, so it can't tell the two behaviours apart).
    """
    print()
    print("--- 20. The history shows only this line's own lineage ---")
    g, gv = seed_product(db, cat, "Reg Lineage Glass", kind="glass")
    first = new_order(db, user)
    sheet_cut = add_item(db, first, g, gv, [line_cut_2d(1200, 900)])
    rems = sheet_cut.details["lineItems"][0]["offcut_sources"][0]["remainders_created"]
    check("the sheet left at least two remainders to branch from", len(rems) >= 2, True)
    small = min(rems, key=lambda r: r["width"] * r["height"])
    large = max(rems, key=lambda r: r["width"] * r["height"])

    a = new_order(db, user)
    add_item(db, a, g, gv, [line_cut_2d(small["width"] - 50, small["height"] - 50)])
    b = new_order(db, user)
    add_item(db, b, g, gv, [line_cut_2d(large["width"] - 50, large["height"] - 50)])
    db.commit()

    def lineage_ids(order):
        plan = rp.build_plan(db, order)
        return {p["piece_id"] for l in plan["lines"] for p in (l["chain"] or {}).get("pieces", [])}

    def fmt(r):
        return f"{r['width']:.0f}x{r['height']:.0f}mm"

    a_ids, b_ids = lineage_ids(a), lineage_ids(b)
    check("each order shows its own branch", bool(a_ids) and bool(b_ids), True)
    check("the two branches share only their common ancestry",
          a_ids & b_ids <= lineage_ids(first) | {small.get("piece_id"), large.get("piece_id")} - {None}, True)
    check("order A's history does not show order B's remainder",
          large.get("piece_id") in a_ids, False)
    check("order B's history does not show order A's remainder",
          small.get("piece_id") in b_ids, False)


def as_browser(value):
    """A value after FastAPI -> JSON -> JavaScript -> JSON -> Python: one number type, so a
    whole-number float (1650.0) comes back an int (1650). req_from_item hands the stored
    dict straight back, which hid exactly this."""
    import json
    value = json.loads(json.dumps(value, default=str))

    def walk(v):
        if isinstance(v, float) and v.is_integer():
            return int(v)
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        if isinstance(v, list):
            return [walk(x) for x in v]
        return v
    return walk(value)


def browser_req(item, **kw):
    req = req_from_item(item, **kw)
    req.details = as_browser(req.details)
    return req


def test_half_sheet_glass_survives_unrelated_edit(db, cat, user):
    """Live report: changing only a silicone's colour asked to confirm the glass cuts.

    The engine writes a half-sheet line's meta l/w as floats (1650.0); through the browser
    they come back as ints, so the untouched glass item never matched itself and was put
    in front of the operator -- and reversed on the (wrong) answer.
    """
    print("\n--- 21. Half-sheet glass is untouched by an unrelated accessory edit ---")
    glass, gvar = seed_product(db, cat, "Matrix Half Glass", kind="glass")
    acc, avar = seed_product(db, cat, "Matrix Silicone", kind="bar")
    _, avar2 = seed_product(db, cat, "Matrix Silicone Clear", kind="bar")
    order = new_order(db, user)

    half = {"type": "sheet-half", "qty": 1, "meta": {"halfSide": "width"},
            "label": "Half Sheet", "rate": 60.0, "total": 60.0}
    cut = dict(line_cut_2d(600, 500), meta={**line_cut_2d(600, 500)["meta"], "rateSqFt": 12})
    glass_item = add_item(db, order, glass, gvar, [half, cut])
    acc_item = add_item(db, order, acc, avar, [line_full(1)])
    glass_item.cutting_completed = True
    db.add(glass_item)
    db.commit()

    stored_meta = glass_item.details["lineItems"][0]["meta"]
    check("the engine enriched the half sheet with float dimensions",
          all(isinstance(stored_meta.get(k), float) for k in ("l", "w")), True)

    glass_stock, glass_pool = stock_of(db, gvar), pool_of(db, glass)
    # The colour change: same accessory line, different variant.
    changed_acc = browser_req(acc_item)
    changed_acc.variantId = avar2.variantId

    plan = orderService.get_reversal_plan(
        order.orderId, db, FakeUser(user.userId),
        incoming_items=[browser_req(glass_item), changed_acc])
    check("no glass line is put to the operator",
          [l["will_reverse"] for l in plan["lines"] if l["item_id"] == glass_item.item_id],
          [False, False])
    check("so the confirmation modal would not open",
          any(l["will_reverse"] is not False for l in plan["lines"]), False)

    edit(db, order, user, [browser_req(glass_item), changed_acc])
    survivors = items_of(db, order)
    check("the glass item survived untouched", glass_item.item_id in survivors, True)
    check("and is still marked cut", survivors[glass_item.item_id].cutting_completed, True)
    check("glass stock is unchanged", stock_of(db, gvar), glass_stock)
    check("the glass pool is unchanged", pool_of(db, glass), glass_pool)

    # Reopening the glass item and saving it unchanged regenerates its lines the way the
    # calculator writes them: half sheet with meta {halfSide} only, a new sq-ft rate.
    reopened = [dict(half), dict(cut, meta={**cut["meta"], "rateSqFt": 15})]
    fresh_glass = survivors[glass_item.item_id]
    plan = orderService.get_reversal_plan(
        order.orderId, db, FakeUser(user.userId),
        incoming_items=[browser_req(fresh_glass, lines=reopened),
                        browser_req(survivors[max(k for k in survivors if k != glass_item.item_id)])])
    check("reopening and saving the glass unchanged is still not an edit",
          [l["will_reverse"] for l in plan["lines"]], [False, False])

    # A real change of the half sheet must still count.
    other_side = [dict(half, meta={"halfSide": "length"}), cut]
    plan = orderService.get_reversal_plan(
        order.orderId, db, FakeUser(user.userId),
        incoming_items=[browser_req(fresh_glass, lines=other_side),
                        browser_req(survivors[max(k for k in survivors if k != glass_item.item_id)])])
    check("changing the split side is an edit",
          [l["will_reverse"] for l in plan["lines"]], [True, True])


def main():
    engine = engine_for_test_db()
    with Session(engine) as db:
        reset(db)
        cat, user = seed_base(db)
        db.commit()
        for fn in (test_full_products_untouched, test_simple_items, test_accessory_units,
                   test_mixed_full_and_cut, test_add_and_remove,
                   test_engine_written_keys_ignored, test_quantity_and_price,
                   test_cart_order_survives_a_partial_edit,
                   test_untouched_unknown_line_does_not_block, test_lifo_within_one_line,
                   test_lifo_across_items, test_stale_manual_offcut_pick,
                   test_fingerprint_ignores_untouched_chains, test_order_age_uses_local_clock,
                   test_shared_sheet_is_cut_if_any_line_is,
                   test_shared_sheet_all_cut_keeps_every_piece,
                   test_legacy_already_cut_is_honoured, test_plan_labels_and_tree,
                   test_calculator_check_during_edit, test_history_shows_only_the_lines_lineage,
                   test_half_sheet_glass_survives_unrelated_edit):
            fn(db, cat, user)

    print("\n" + "=" * 68)
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"   - {f}")
        raise SystemExit(1)
    print("All order-edit matrix checks passed.")


if __name__ == "__main__":
    main()
