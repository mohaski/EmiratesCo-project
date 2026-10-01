"""
Phase 3 — per-cut-line physical-cut confirmation.

Proves the thing the feature exists for: an ALREADY_CUT line is never recombined into a
whole bar, whatever the chain says, while a NOT_CUT line still is. Plus the validation
rules that keep an unanswered or unknown line from being guessed at, and that a batch of
independent answers across different products resolves together.

Material accounting is checked explicitly, including a `retained` term — when the
customer keeps an already-cut piece, that material legitimately leaves the building, and
the books have to say so rather than silently losing it.

    python test_offcut_confirmation.py
"""
from datetime import datetime
from uuid import uuid4

from sqlmodel import Session, SQLModel, create_engine, select

from entities.offcutLedger import STATE_AVAILABLE, STATE_RETIRED, OffcutPiece
from entities.offcuts import Offcut
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.products import Product
from entities.variants import Variant

from core.inventory import offcutLedger as ledger
from core.inventory import reversalPlan as rp
from core.inventory.inventoryService import (
    deduct_stock_for_order_item,
    restore_stock_for_order_item,
)

FULL_BAR = 6.0
CUT = 1.8
START_STOCK = 10

failures = []


def check(label, got, want):
    ok = got == want
    print(f"    [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    if not ok:
        failures.append(label)


def check_raises(label, fn, must_contain=None):
    try:
        fn()
    except ValueError as e:
        ok = must_contain is None or must_contain.lower() in str(e).lower()
        print(f"    [{'PASS' if ok else 'FAIL'}] {label}: refused - {e}")
        if not ok:
            failures.append(label)
        return
    print(f"    [FAIL] {label}: expected a refusal, got none")
    failures.append(label)


def make_db() -> Session:
    engine = create_engine("sqlite://")
    SQLModel.metadata.tables["offcuts"].dialect_options["sqlite"]["autoincrement"] = True
    names = ("products", "variants", "attribute_classes", "offcuts", "orders",
             "orderitems", "offcut_pieces", "offcut_piece_events",
             "stock_input_session_items")
    SQLModel.metadata.create_all(engine, tables=[SQLModel.metadata.tables[n] for n in tuple(names) + ("stock_operations", "stock_journal")])
    return Session(engine)


def seed_bar(db, name="Confirm Test Bar"):
    product = Product(name=name, category_id=1, stock_quantity=START_STOCK,
                      track_offcuts=True, has_variants=True)
    db.add(product)
    db.flush()
    variant = Variant(product_id=product.productId, name="", attributes={},
                      stock_quantity=START_STOCK, price=100.0, length=FULL_BAR,
                      min_usable=0.4)
    db.add(variant)
    db.flush()
    return product, variant


def cut_item(db, product, variant, order_id, length, *, reported_cut=False):
    order = db.get(Order, order_id) or Order(
        orderId=order_id, servedby=uuid4(), customer_name=f"Customer {order_id}",
        subtotal=0, total=0, status="confirmed", payment_status="Unpaid")
    db.add(order)
    db.flush()
    item = OrderItem(
        order_id=order_id, product_id=product.productId, variant_id=variant.variantId,
        total_price=0.0, status="purchased",
        details={"lineItems": [{"type": "accessory-cut", "qty": 1, "meta": {"length": length}}]},
    )
    db.add(item)
    db.flush()
    deduct_stock_for_order_item(db, item)
    db.flush()
    if reported_cut:
        # What the cutting queue does when the floor reports a batch finished.
        item.cutting_completed = True
        item.cutting_completed_at = datetime.utcnow()
        db.add(item)
        db.flush()
    return order, item


def pool(db, product):
    rows = db.exec(
        select(Offcut).where(Offcut.product_id == product.productId, Offcut.quantity > 0)
        .order_by(Offcut.length.asc())
    ).all()
    return [(round(r.length, 4), r.quantity, r.status) for r in rows]


def pool_total(db, product):
    return round(sum(l * q for l, q, _ in pool(db, product)), 4)


# ── 1. Default state comes from the cutting flags ─────────────────────────────

def test_defaults():
    print("\n--- 1. Default physical state, derived from the cutting flags ---")
    db = make_db()
    product, variant = seed_bar(db)

    _, pending = cut_item(db, product, variant, 701, CUT)
    check("a cut line still in the queue defaults to NOT_CUT",
          rp.default_physical_state(pending), rp.PHYS_NOT_CUT)

    _, reported = cut_item(db, product, variant, 702, CUT, reported_cut=True)
    check("a line reported done defaults to ALREADY_CUT",
          rp.default_physical_state(reported), rp.PHYS_ALREADY_CUT)

    # cutting_completed True with no timestamp is the "nothing to cut" default, which on a
    # line that demonstrably HAS cuts means nothing ever flagged it - genuinely unknown.
    reported.cutting_completed = True
    reported.cutting_completed_at = None
    db.add(reported)
    db.flush()
    check("a cut line nothing ever flagged defaults to UNKNOWN",
          rp.default_physical_state(reported), rp.PHYS_UNKNOWN)


# ── 2. NOT_CUT vs ALREADY_CUT on identical starting state ────────────────────

def run_confirmed(physical_state, resolution):
    """Same order, same bar, different confirmed answer. Returns what came back."""
    db = make_db()
    product, variant = seed_bar(db)
    order, item = cut_item(db, product, variant, 801, CUT, reported_cut=True)

    plan = rp.build_plan(db, order)
    ref = plan["lines"][0]["line_ref"]
    decisions = rp.validate_decisions(
        plan, {ref: {"physicalState": physical_state, "resolution": resolution}})

    src = item.details["lineItems"][0]["offcut_sources"][0]
    source_piece_id = src["source_piece_id"]
    remainder_piece_id = src["remainder_piece_id"]

    restore_stock_for_order_item(db, item, decisions=decisions)
    order.status = "cancelled"
    db.flush()

    source = db.get(OffcutPiece, source_piece_id)
    remainder = db.get(OffcutPiece, remainder_piece_id)
    return {
        "stock": variant.stock_quantity,
        "pool": pool(db, product),
        "pool_total": pool_total(db, product),
        "source_state": source.state if source else None,
        "remainder_state": remainder.state if remainder else None,
        "plan_line": plan["lines"][0],
    }


def test_confirmed_outcomes():
    print("\n--- 2. The same bar, under each confirmed answer ---")

    not_cut = run_confirmed(rp.PHYS_NOT_CUT, None)
    print(f"      NOT_CUT                    stock={not_cut['stock']} pool={not_cut['pool']}")
    check("an uncut bar goes back to stock whole", not_cut["stock"], START_STOCK)
    check("its remainder stops existing", not_cut["remainder_state"], STATE_RETIRED)
    check("nothing is left in the pool", not_cut["pool"], [])

    pooled = run_confirmed(rp.PHYS_ALREADY_CUT, rp.RES_RETURN_TO_POOL)
    print(f"      ALREADY_CUT/return_to_pool stock={pooled['stock']} pool={pooled['pool']}")
    check("an already-cut bar is NOT credited back to stock", pooled["stock"], START_STOCK - 1)
    check("the source piece is retired - the saw has run", pooled["source_state"], STATE_RETIRED)
    check("its remainder is left alone on the floor",
          pooled["remainder_state"], STATE_AVAILABLE)
    check("this cut's own 1.8 returns to the pool, available",
          pooled["pool"], [(1.8, 1, "available"), (4.2, 1, "available")])
    check("material is conserved: the whole bar is accounted for",
          pooled["pool_total"], FULL_BAR)

    scrapped = run_confirmed(rp.PHYS_ALREADY_CUT, rp.RES_SCRAP)
    print(f"      ALREADY_CUT/scrap          stock={scrapped['stock']} pool={scrapped['pool']}")
    check("stock is not credited", scrapped["stock"], START_STOCK - 1)
    check("this cut's piece comes back as scrap, not pickable stock",
          scrapped["pool"], [(1.8, 1, "scrap"), (4.2, 1, "available")])
    check("scrap still counts as material on the floor",
          scrapped["pool_total"], FULL_BAR)

    retained = run_confirmed(rp.PHYS_ALREADY_CUT, rp.RES_CUSTOMER_RETAINED)
    print(f"      ALREADY_CUT/retained       stock={retained['stock']} pool={retained['pool']}")
    check("stock is not credited", retained["stock"], START_STOCK - 1)
    check("nothing is returned to the pool",
          retained["pool"], [(4.2, 1, "available")])
    check("the missing 1.8 is exactly what the customer walked off with",
          round(FULL_BAR - retained["pool_total"], 4), CUT)

    line = not_cut["plan_line"]
    check("a line reported cut always demands an explicit answer",
          line["requires_explicit_answer"], True)
    # Only return-to-pool is OFFERED to the operator; scrap and customer_retained stay
    # valid API values (exercised just above) but are not choices made at cancel/edit time.
    check("only return-to-pool is offered to the operator",
          line["allowed_resolutions"], list(rp.OFFERED_RESOLUTIONS))
    check("the other two are still accepted by the API",
          sorted(rp.RESOLUTIONS), ["customer_retained", "return_to_pool", "scrap"])
    check("the default resolution is return-to-pool",
          line["default_resolution"], rp.RES_RETURN_TO_POOL)


# ── 3. Validation ────────────────────────────────────────────────────────────

def test_validation():
    print("\n--- 3. Validation: nothing is guessed at ---")
    db = make_db()
    product, variant = seed_bar(db)
    order, item = cut_item(db, product, variant, 901, CUT, reported_cut=True)
    plan = rp.build_plan(db, order)
    ref = plan["lines"][0]["line_ref"]

    check_raises("a line reported cut cannot be left unanswered",
                 lambda: rp.validate_decisions(plan, {}),
                 must_contain="confirm whether the cutting has been done")

    check_raises("an UNKNOWN answer blocks the reversal",
                 lambda: rp.validate_decisions(plan, {ref: {"physicalState": rp.PHYS_UNKNOWN}}),
                 must_contain="floor check")

    check_raises("an unrecognised cut status is rejected",
                 lambda: rp.validate_decisions(plan, {ref: {"physicalState": "maybe"}}),
                 must_contain="unknown cut status")

    check_raises("an unrecognised resolution is rejected",
                 lambda: rp.validate_decisions(
                     plan, {ref: {"physicalState": rp.PHYS_ALREADY_CUT, "resolution": "burn it"}}),
                 must_contain="unknown resolution")

    check_raises("an answer for a line that isn't on this order is rejected",
                 lambda: rp.validate_decisions(plan, {"99999:0": {"physicalState": rp.PHYS_NOT_CUT}}),
                 must_contain="not part of this order")

    # An untouched order needs no payload at all — this is the common case and it has to
    # keep behaving exactly as it did before Phase 3.
    _, fresh_item = cut_item(db, product, variant, 902, CUT)
    fresh_order = db.get(Order, 902)
    fresh_plan = rp.build_plan(db, fresh_order)
    check("a fresh order needs no confirmation payload",
          fresh_plan["all_defaults_safe"], True)
    decisions = rp.validate_decisions(fresh_plan, None)
    check("its line falls back to NOT_CUT",
          decisions.for_line(fresh_item.item_id, 0)["physical_state"], rp.PHYS_NOT_CUT)

    # snake_case is accepted alongside camelCase, so a hand-rolled API call works too.
    alt = rp.validate_decisions(plan, {ref: {"physical_state": rp.PHYS_ALREADY_CUT}})
    check("snake_case physical_state is accepted",
          alt.for_line(item.item_id, 0)["physical_state"], rp.PHYS_ALREADY_CUT)
    check("its resolution falls back to the default",
          alt.for_line(item.item_id, 0)["resolution"], rp.RES_RETURN_TO_POOL)


# ── 4. A batch across two products, answered independently ───────────────────

def test_batch():
    print("\n--- 4. One order, two products, two different answers, applied together ---")
    db = make_db()
    bar_a, var_a = seed_bar(db, "Batch Bar A")
    bar_b, var_b = seed_bar(db, "Batch Bar B")

    order = Order(orderId=1001, servedby=uuid4(), customer_name="Batch Customer",
                  subtotal=0, total=0, status="confirmed", payment_status="Unpaid")
    db.add(order)
    db.flush()

    items = []
    for product, variant in ((bar_a, var_a), (bar_b, var_b)):
        item = OrderItem(
            order_id=1001, product_id=product.productId, variant_id=variant.variantId,
            total_price=0.0, status="purchased",
            details={"lineItems": [{"type": "accessory-cut", "qty": 1, "meta": {"length": CUT}}]},
        )
        db.add(item)
        db.flush()
        deduct_stock_for_order_item(db, item)
        db.flush()
        items.append(item)

    # Product A's bar was cut on the floor; product B's was not.
    items[0].cutting_completed = True
    items[0].cutting_completed_at = datetime.utcnow()
    db.add(items[0])
    db.flush()

    plan = rp.build_plan(db, order)
    check("both cut lines are planned", len(plan["lines"]), 2)
    check("they are separate line refs",
          len({l["line_ref"] for l in plan["lines"]}), 2)
    check("only the reported-cut line demands an answer",
          sorted(l["requires_explicit_answer"] for l in plan["lines"]), [False, True])

    by_product = {l["product_name"]: l for l in plan["lines"]}
    decisions = rp.validate_decisions(plan, {
        by_product["Batch Bar A"]["line_ref"]: {
            "physicalState": rp.PHYS_ALREADY_CUT, "resolution": rp.RES_RETURN_TO_POOL},
        by_product["Batch Bar B"]["line_ref"]: {"physicalState": rp.PHYS_NOT_CUT},
    })

    for item in items:
        restore_stock_for_order_item(db, item, decisions=decisions)
    order.status = "cancelled"
    db.flush()

    check("A (already cut) keeps its bar out of stock", var_a.stock_quantity, START_STOCK - 1)
    check("A's own piece and remainder are both in the pool",
          [l for l, _, _ in pool(db, bar_a)], [1.8, 4.2])
    check("B (not cut) gets its whole bar back", var_b.stock_quantity, START_STOCK)
    check("B leaves nothing in the pool", pool(db, bar_b), [])

    summary = rp.decisions_summary(plan, decisions)
    check("the audit summary records both answers", len(summary), 2)
    check("and the resolution chosen for the already-cut line",
          sorted(filter(None, (r["resolution"] for r in summary))), [rp.RES_RETURN_TO_POOL])


# ── 5. Editing an already-cut order re-resolves against what came back ───────

def test_edit_reuses_returned_pieces():
    """Editing an already-cut line puts the cut size(s) into the offcut pool alongside
    the remainders they generated, and the replacement cut is then resolved against that
    pool — reusing a returned piece if one is big enough, otherwise drawing a fresh bar.

    This mirrors what orderService.update_order does (restore everything, delete the old
    items, then deduct for the new ones) without the HTTP/auth stack, so the reuse is
    measured rather than assumed.
    """
    print("\n--- 5. Editing an already-cut order: the returned pieces are reusable ---")

    def edit_to(new_length):
        db = make_db()
        product, variant = seed_bar(db)
        order, item = cut_item(db, product, variant, 1101, CUT, reported_cut=True)

        plan = rp.build_plan(db, order)
        decisions = rp.validate_decisions(plan, {
            plan["lines"][0]["line_ref"]: {
                "physicalState": rp.PHYS_ALREADY_CUT,
                "resolution": rp.RES_RETURN_TO_POOL,
            }})

        restore_stock_for_order_item(db, item, decisions=decisions)
        db.delete(item)
        db.flush()
        pool_after_restore = [l for l, _, _ in pool(db, product)]

        replacement = OrderItem(
            order_id=1101, product_id=product.productId, variant_id=variant.variantId,
            total_price=0.0, status="purchased",
            details={"lineItems": [
                {"type": "accessory-cut", "qty": 1, "meta": {"length": new_length}}]},
        )
        db.add(replacement)
        db.flush()
        deduct_stock_for_order_item(db, replacement)
        db.flush()

        src = replacement.details["lineItems"][0]["offcut_sources"][0]
        return {
            "pool_after_restore": pool_after_restore,
            "source": src["source"],
            "offcut_length": src.get("offcut_length"),
            "stock": variant.stock_quantity,
            "pool": [l for l, _, _ in pool(db, product)],
        }

    # The cut size AND the remainder it generated are both in the pool before re-cutting.
    small = edit_to(1.5)
    check("the cut size and its generated offcut are both in the pool",
          small["pool_after_restore"], [1.8, 4.2])

    # 1.5 fits the returned 1.8 piece, and best-fit prefers the smallest that fits.
    check("the replacement cut reuses a returned piece", small["source"], "offcut")
    check("and picks the returned cut size, not the bigger remainder",
          small["offcut_length"], 1.8)
    check("so no new bar is drawn", small["stock"], START_STOCK - 1)
    check("leaving the 4.2 remainder plus a 0.3 offcut",
          small["pool"], [0.3, 4.2])

    # Nothing in the pool is big enough for 5.0, so a fresh bar is drawn.
    big = edit_to(5.0)
    check("a cut too big for anything returned draws a fresh bar",
          big["source"], "full_bar")
    check("which is the second bar off this product", big["stock"], START_STOCK - 2)
    check("the returned pieces are left untouched in the pool",
          [l for l in big["pool"] if l in (1.8, 4.2)], [1.8, 4.2])


# ── 6. Phase 4: the plan token catches a chain that moved ────────────────────

def test_plan_token():
    """A confirmation is made against a plan; if another sale consumes one of the pieces
    that plan's verdicts rest on, the token no longer matches and the reversal is refused
    with a fresh plan rather than applied on a stale verdict."""
    print()
    print("--- 6. Plan token: stale confirmations are refused ---")
    db = make_db()
    product, variant = seed_bar(db)

    # Order A cuts 4.5 off a fresh bar, leaving 1.5. Reported cut, so it needs an answer.
    order_a, item_a = cut_item(db, product, variant, 1201, 4.5, reported_cut=True)

    plan = rp.build_plan(db, order_a)
    token = plan["plan_token"]
    check("the plan carries a token", bool(token), True)
    check("the token is stable while nothing changes",
          rp.sign_plan(rp.plan_fingerprint(db, plan)), token)
    check("the plan records which pieces its verdict rests on",
          bool(plan["lines"][0]["_piece_ids"]), True)

    # Nothing has moved yet, so the token still validates.
    rp.assert_plan_fresh(db, plan, token)
    print("    [PASS] a fresh token validates")

    # Another order now cuts into the 1.5 remainder this plan was reasoning about.
    cut_item(db, product, variant, 1202, 1.0)

    stale = None
    try:
        rp.assert_plan_fresh(db, rp.build_plan(db, order_a), token)
    except rp.PlanStaleError as e:
        stale = e
    check("a token from before the change is rejected", stale is not None, True)
    if stale is not None:
        check("the refusal carries a fresh plan to re-confirm against",
              bool(stale.fresh_plan.get("plan_token")), True)
        check("and the fresh token differs from the stale one",
              stale.fresh_plan["plan_token"] != token, True)
        check("the fresh plan now shows the blocker",
              len(stale.fresh_plan["lines"][0]["blockers"]), 1)

    # A tampered token is rejected too - the fingerprint is signed, not just hashed.
    tampered = ("0" * 32) if token != "0" * 32 else "1" * 32
    try:
        rp.assert_plan_fresh(db, rp.build_plan(db, order_a), tampered)
        check("a forged token is rejected", False, True)
    except rp.PlanStaleError:
        print("    [PASS] a forged token is rejected")

    # No token at all stays acceptable: the confirmation payload is optional in the first
    # place, and older clients predate the field.
    rp.assert_plan_fresh(db, rp.build_plan(db, order_a), None)
    print("    [PASS] a missing token is accepted (optional payload, older clients)")

    # Locking the decision pieces must not blow up or change anything.
    fresh_plan = rp.build_plan(db, order_a)
    before = pool(db, product)
    rp.lock_decision_pieces(db, fresh_plan)
    check("locking the decision pieces is side-effect free", pool(db, product), before)


# -- 7. Reporting a cut must not complete (and so lock) the order -------------

def test_cutting_report_leaves_status_alone():
    """mark_cutting_complete_for_orders_batch used to also set order.status="completed".
    That conflated "the metal has been cut" with "this sale is finished", and since
    update_order refuses a completed order it made every cut order permanently
    uneditable - the exact case the confirmation flow exists for.

    Nothing ever read status=="completed" (the only status any code compares against is
    "cancelled") and the cutting queue filters on OrderItem.cutting_completed, so dropping
    it costs nothing. Completing an order is now only ever a human action.
    """
    print()
    print("--- 7. Reporting a cut leaves the order's workflow status alone ---")

    from fastapi import HTTPException
    from core.ordering import orderService

    class FakeUser:
        role = "manager"
        userId = "00000000-0000-0000-0000-000000000000"
        username = "tester"

    db = make_db()
    product, variant = seed_bar(db)
    order, item = cut_item(db, product, variant, 1301, CUT)
    order.status = "confirmed"
    db.add(order)
    db.commit()

    result = orderService.mark_cutting_complete_for_orders_batch([order.orderId], db, FakeUser())
    db.refresh(order)
    db.refresh(item)

    check("the item is flagged cut", item.cutting_completed, True)
    check("with a timestamp", item.cutting_completed_at is not None, True)
    check("the order's workflow status is untouched", order.status, "confirmed")
    check("the order is still reported as processed", result["updated_orders"], [order.orderId])
    check("so it no longer shows in the cutting queue",
          [o["orderId"] for o in orderService.get_pending_cutting_orders(db, FakeUser())], [])

    # And because it is not completed, it is still editable - past the status guard and
    # into the cut-confirmation flow.
    def guard_message(status):
        """The detail update_order refuses with at the status guard, or None if it got
        past it. Anything past the guard fails on this cut-down SQLite schema instead,
        which is what "the guard let it through" looks like here."""
        o = db.get(Order, 1301)
        o.status = status
        db.add(o)
        db.commit()
        try:
            orderService.update_order(1301, None, db, FakeUser())
        except HTTPException as e:
            detail = e.detail if isinstance(e.detail, str) else ""
            return detail if "Cannot edit" in detail else None
        except Exception:
            return None
        finally:
            db.rollback()
        return None

    check("a cut-but-unfinished order gets past the status guard",
          guard_message("confirmed"), None)
    check("a genuinely completed order is still blocked",
          guard_message("completed"), "Cannot edit a completed order")
    check("a cancelled order is still blocked",
          guard_message("cancelled"), "Cannot edit a cancelled order")


def main():
    test_defaults()
    test_confirmed_outcomes()
    test_validation()
    test_batch()
    test_edit_reuses_returned_pieces()
    test_plan_token()
    test_cutting_report_leaves_status_alone()

    print("\n" + "=" * 66)
    if failures:
        print(f"{len(failures)} FAILURE(S): " + ", ".join(failures))
        raise SystemExit(1)
    print("All confirmation checks passed.")


if __name__ == "__main__":
    main()
