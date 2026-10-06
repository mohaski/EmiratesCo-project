"""
Undo and Correct-cut-answers (core/audit/undo.py) against the TEST database.

The property that matters: a mistaken answer followed by a correction must leave EXACTLY the
state the right answer would have left from the start - same stock, same pool, same
available pieces, same order - and an undo must leave exactly the state before the change.
Every step also runs the consistency check (core/audit/integrity.py).

Run against emiratesco_edit_test only (it truncates tables):

    python test_undo_correct.py
"""
import json

from sqlmodel import Session, select, text

import test_order_edit_matrix as M
from core.audit import integrity
from core.audit import undo as undo_engine
from core.inventory import reversalPlan as rp
from core.ordering import operationsService, orderService
from entities.offcutLedger import OffcutPiece
from entities.offcuts import Offcut
from entities.opJournal import StockOperation
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.variants import Variant

check = M.check
failures = M.failures

CUT = {"physicalState": rp.PHYS_ALREADY_CUT, "resolution": rp.RES_RETURN_TO_POOL}
NOT_CUT = {"physicalState": rp.PHYS_NOT_CUT}


def fresh():
    engine = M.engine_for_test_db()
    db = Session(engine)
    M.reset(db)
    db.exec(text("TRUNCATE stock_operations, stock_journal RESTART IDENTITY"))
    db.commit()
    cat, user = M.seed_base(db)
    db.commit()
    M.rebaseline(db)  # no products yet: each test's seeding is journaled from its insert
    return db, cat, user


def ok_integrity(db, label):
    res = integrity.check(db)
    check(f"{label}: consistency check", res["errors"], [])


def snapshot(db, order, products):
    pids = [p.productId for p in products]
    db.expire_all()
    stock = sorted((v.product_id, v.stock_quantity) for v in
                   db.exec(select(Variant).where(Variant.product_id.in_(pids))).all())
    pool = sorted((r.product_id, round(r.length or 0, 3), r.width, r.height, r.status, r.quantity)
                  for r in db.exec(select(Offcut).where(Offcut.product_id.in_(pids), Offcut.quantity > 0)).all())
    pieces = sorted((p.product_id, round(p.length or 0, 3), p.width, p.height, p.is_scrap)
                    for p in db.exec(select(OffcutPiece).where(OffcutPiece.product_id.in_(pids),
                                                               OffcutPiece.state == "available")).all())
    o = db.get(Order, order.orderId)
    items = []
    for it in db.exec(select(OrderItem).where(OrderItem.order_id == order.orderId)).all():
        lines = [{k: v for k, v in l.items() if k not in ("offcut_sources", "_resolved_as_2d")}
                 for l in (it.details or {}).get("lineItems") or []]
        items.append((it.product_id, it.variant_id, json.dumps(lines, sort_keys=True, default=str),
                      it.cutting_completed))
    return {"stock": stock, "pool": pool, "pieces": pieces,
            "order": (o.status, round(o.total, 2), round(o.amountPayed or 0, 2), round(o.balance or 0, 2)),
            "items": sorted(items)}


def last_op(db, order):
    return db.exec(select(StockOperation).where(StockOperation.order_id == order.orderId)
                   .order_by(StockOperation.created_at.desc())).first()


def ref_of(db, order, item):
    plan = orderService.get_reversal_plan(order.orderId, db, M.FakeUser(M_user[0].userId))
    return [l["line_ref"] for l in plan["lines"] if l["item_id"] == item.item_id]


M_user = [None]


def bar_order(db, cat, user, name, cut=6.0):
    bar, var = M.seed_product(db, cat, name, kind="bar")
    var.length = 21.0
    db.add(var)
    db.flush()
    acc, avar = M.seed_product(db, cat, name + " acc", kind="simple")
    order = M.new_order(db, user)
    item = M.add_item(db, order, bar, var, [M.line_cut_1d(cut)])
    acc_item = M.simple_item(db, order, acc, avar, 2)
    item.cutting_completed = True
    item.cutting_completed_at = __import__("datetime").datetime.utcnow()
    db.add(item)
    db.commit()
    return bar, var, acc, avar, order, item, acc_item


# ── 1. Undo returns exactly the state before the edit ─────────────────────────
def test_undo_exact():
    print("\n--- U1. Undo an edit: exactly the state before it ---")
    db, cat, user = fresh()
    M_user[0] = user
    bar, var, acc, avar, order, item, acc_item = bar_order(db, cat, user, "U1 Bar")
    before = snapshot(db, order, [bar, acc])
    refs = ref_of(db, order, item)
    M.edit(db, order, user, [M.req_from_item(item, lines=[M.line_cut_1d(8)]), M.req_from_item(acc_item)],
           confirmations={refs[0]: CUT})
    after_edit = snapshot(db, order, [bar, acc])
    check("the edit changed something", after_edit != before, True)
    op = last_op(db, order)
    undo_engine.undo_operation(db, op.op_id, actor=M.FakeUser(user.userId), reason="test")
    db.commit()
    check("undo restores stock", snapshot(db, order, [bar, acc])["stock"], before["stock"])
    check("undo restores the pool", snapshot(db, order, [bar, acc])["pool"], before["pool"])
    check("undo restores available pieces", snapshot(db, order, [bar, acc])["pieces"], before["pieces"])
    check("undo restores the order", snapshot(db, order, [bar, acc])["order"], before["order"])
    check("undo restores the items", snapshot(db, order, [bar, acc])["items"], before["items"])
    check("original item id is back", db.get(OrderItem, item.item_id) is not None, True)
    check("the edit is marked undone", db.get(StockOperation, op.op_id).status, "undone")
    ok_integrity(db, "after undo")
    # the undone edit cannot be undone twice
    try:
        undo_engine.undo_operation(db, op.op_id, actor=M.FakeUser(user.userId), reason="again")
        check("second undo refused", False, True)
    except undo_engine.UndoRefused as e:
        db.rollback()
        check("second undo refused", any("already been undone" in r for r in e.reasons), True)
    db.close()


# ── 2. Wrong answer + correction == right answer from the start ───────────────
def scenario_1d(answer_first, correct_to=None):
    db, cat, user = fresh()
    M_user[0] = user
    bar, var, acc, avar, order, item, acc_item = bar_order(db, cat, user, "C Bar")
    # a later order cuts into this bar's leftover (the blocker case from the plan)
    other = M.new_order(db, user)
    M.add_item(db, other, bar, var, [M.line_cut_1d(8)])
    db.commit()
    refs = ref_of(db, order, item)
    M.edit(db, order, user, [M.req_from_item(item, lines=[M.line_cut_1d(8)]), M.req_from_item(acc_item)],
           confirmations={refs[0]: answer_first})
    if correct_to is not None:
        op = last_op(db, order)
        undo_engine.correct_operation(db, op.op_id, actor=M.FakeUser(user.userId), reason="test",
                                      cut_confirmations={refs[0]: correct_to})
        db.commit()
    snap = snapshot(db, order, [bar, acc])
    ok_integrity(db, f"1D {answer_first['physicalState']} -> {correct_to and correct_to['physicalState']}")
    db.close()
    return snap


def test_correct_equals_direct():
    print("\n--- U2. 1D: answered 'not cut' by mistake, corrected to 'already cut' ---")
    direct = scenario_1d(CUT)
    corrected = scenario_1d(NOT_CUT, correct_to=CUT)
    for part in ("stock", "pool", "pieces", "order", "items"):
        check(f"corrected == direct: {part}", corrected[part], direct[part])
    print("\n--- U3. 1D: answered 'already cut' by mistake, corrected to 'not cut' ---")
    direct = scenario_1d(NOT_CUT)
    corrected = scenario_1d(CUT, correct_to=NOT_CUT)
    for part in ("stock", "pool", "pieces", "order", "items"):
        check(f"corrected == direct: {part}", corrected[part], direct[part])


# ── 3. Refused when a later sale used what the edit returned ──────────────────
def test_refused_when_used():
    print("\n--- U4. Undo refused once another order used the returned piece ---")
    db, cat, user = fresh()
    M_user[0] = user
    bar, var, acc, avar, order, item, acc_item = bar_order(db, cat, user, "U4 Bar")
    refs = ref_of(db, order, item)
    # already cut, edited down to 4: the 6 comes back to the pool, the 4 is cut from it
    M.edit(db, order, user, [M.req_from_item(item, lines=[M.line_cut_1d(4)]), M.req_from_item(acc_item)],
           confirmations={refs[0]: CUT})
    op = last_op(db, order)
    # a later sale cuts 1.5 - best fit is the 2.00 leftover this very edit created (6 - 4)
    later = M.new_order(db, user)
    M.add_item(db, later, bar, var, [M.line_cut_1d(1.5)])
    db.commit()
    info = undo_engine.analyse(db, op.op_id)
    check("undo is refused", bool(info["reasons"]), True)
    check("the reason names the use", any("since been used" in r for r in info["reasons"]), True)
    res = operationsService.preview_undo(op.op_id, db, M.FakeUser(user.userId))
    check("preview reports it cannot be undone", res["undoable"], False)
    db.close()


# ── 4. LIFO, and an undone later edit does not block ─────────────────────────
def test_lifo():
    print("\n--- U5. Two edits: the earlier waits for the later; undoing both restores the start ---")
    db, cat, user = fresh()
    M_user[0] = user
    bar, var, acc, avar, order, item, acc_item = bar_order(db, cat, user, "U5 Bar")
    start = snapshot(db, order, [bar, acc])
    M.edit(db, order, user, [M.req_from_item(item), M.req_from_item(acc_item, quantity=5)])
    first = last_op(db, order)
    acc_item2 = [i for i in db.exec(select(OrderItem).where(OrderItem.order_id == order.orderId)).all()
                 if i.product_id == acc.productId][0]
    M.edit(db, order, user, [M.req_from_item(item), M.req_from_item(acc_item2, quantity=7)])
    second = last_op(db, order)
    info = undo_engine.analyse(db, first.op_id)
    check("the earlier edit waits for the later one", any("undo that first" in r for r in info["reasons"]), True)
    undo_engine.undo_operation(db, second.op_id, actor=M.FakeUser(user.userId), reason="t")
    db.commit()
    undo_engine.undo_operation(db, first.op_id, actor=M.FakeUser(user.userId), reason="t")
    db.commit()
    end = snapshot(db, order, [bar, acc])
    for part in ("stock", "pool", "pieces", "order", "items"):
        check(f"both undone == start: {part}", end[part], start[part])
    ok_integrity(db, "after both undos")
    db.close()


# ── 5. Undo a cancellation ───────────────────────────────────────────────────
def test_undo_cancel():
    print("\n--- U6. Undo a cancellation (with a refund) ---")
    db, cat, user = fresh()
    M_user[0] = user
    bar, var, acc, avar, order, item, acc_item = bar_order(db, cat, user, "U6 Bar")
    o = db.get(Order, order.orderId)
    o.total, o.amountPayed, o.balance, o.payment_status = 1000.0, 400.0, 600.0, "Partial"
    db.add(o)
    db.commit()
    before = snapshot(db, order, [bar, acc])
    refs = ref_of(db, order, item)
    from core.audit.opContext import operation
    with operation(db, "cancel", actor=M.FakeUser(user.userId), order_id=order.orderId, request={}):
        orderService.apply_cancel(order.orderId, db, M.FakeUser(user.userId),
                                  cut_confirmations={refs[0]: CUT}, enforce_window=False)
    db.commit()
    check("cancelled", db.get(Order, order.orderId).status, "cancelled")
    op = last_op(db, order)
    res = operationsService.preview_undo(op.op_id, db, M.FakeUser(user.userId))
    check("preview says it can be undone", res["undoable"], True)
    check("preview mentions the refund", bool(res["money_note"]), True)
    undo_engine.undo_operation(db, op.op_id, actor=M.FakeUser(user.userId), reason="t")
    db.commit()
    after = snapshot(db, order, [bar, acc])
    check("status restored", after["order"][0], before["order"][0])
    check("stock restored", after["stock"], before["stock"])
    check("pool restored", after["pool"], before["pool"])
    check("pieces restored", after["pieces"], before["pieces"])
    check("the refunded money is owed again", after["order"][3], 1000.0)
    ok_integrity(db, "after undoing a cancel")
    db.close()


# ── 6. A new cut's remainder merged into another order's row: undo restores its source ─
def test_undo_restores_merged_row_source():
    print("\n--- U7. Edit's remainder merged into another order's leftover: undo restores its source ---")
    db, cat, user = fresh()
    M_user[0] = user
    bar, var, acc, avar, order, item, acc_item = bar_order(db, cat, user, "U7 Bar")
    # another order cuts 13 from this bar's 15 leftover: a 2.00 leftover that came from ITS item
    other = M.new_order(db, user)
    other_item = M.add_item(db, other, bar, var, [M.line_cut_1d(13)])
    db.commit()
    two = [r for r in db.exec(select(Offcut).where(Offcut.product_id == bar.productId, Offcut.quantity > 0)).all()
           if abs((r.length or 0) - 2.0) < 1e-6]
    check("a 2.00 leftover from the other order", [(r.quantity, r.source_item_id) for r in two],
          [(1, other_item.item_id)])
    before = snapshot(db, order, [bar, acc])
    refs = ref_of(db, order, item)
    # already cut, edited to 4: the 6 comes back, the 4 is cut from it, and its 2.00 remainder
    # lands on that same row - which the cut re-points at the edit's item (order 205, row 4333)
    M.edit(db, order, user, [M.req_from_item(item, lines=[M.line_cut_1d(4)]), M.req_from_item(acc_item)],
           confirmations={refs[0]: CUT})
    db.expire_all()
    row = db.get(Offcut, two[0].offcutId)
    check("the remainder merged into the row", row.quantity, 2)
    check("the cut re-pointed the row at the edit's item", row.source_item_id != other_item.item_id, True)
    op = last_op(db, order)
    undo_engine.undo_operation(db, op.op_id, actor=M.FakeUser(user.userId), reason="t")
    db.commit()
    db.expire_all()
    row = db.get(Offcut, two[0].offcutId)
    check("undo: the row is back to 1", row.quantity, 1)
    check("undo: the row is linked to the other order's item again", row.source_item_id, other_item.item_id)
    after = snapshot(db, order, [bar, acc])
    for part in ("stock", "pool", "pieces", "order", "items"):
        check(f"undo == before: {part}", after[part], before[part])
    ok_integrity(db, "after undoing the merge")
    db.close()


def main():
    for fn in (test_undo_exact, test_correct_equals_direct, test_refused_when_used, test_lifo,
               test_undo_cancel, test_undo_restores_merged_row_source):
        fn()
    print("\n" + "=" * 68)
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"   - {f}")
        raise SystemExit(1)
    print("All undo/correct checks passed.")


if __name__ == "__main__":
    main()
