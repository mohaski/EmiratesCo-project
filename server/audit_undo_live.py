"""
Undo audit against REAL orders - every change rolled back (live_rollback).

For each open order:
  edit + undo     touch one item (the same change audit_edit_live makes), undo it, and require
                  every stock counter, offcut row, ledger piece, order item, the order itself,
                  its credit row and any open container to be exactly as before
  cancel + undo   the same for a cancellation
  edit + correct  re-run the edit with the same answers: stock and the offcut pool must end
                  where the edit alone left them

    python audit_undo_live.py            # all open orders
    python audit_undo_live.py 201 204    # just these
"""
import json
import sys
from collections import Counter

from sqlmodel import select, text

import entities  # noqa: F401
from live_rollback import live_session
from entities.orders import Order
from entities.users import User
from core.audit import undo as undo_engine
from core.audit.opContext import operation
from core.inventory import reversalPlan as rp
from core.ordering import orderService
from audit_edit_live import Manager, frontend_request, edit_request, default_answers


def snapshot(db, order_id):
    c = db.connection()
    pids = [r[0] for r in c.execute(text("select distinct product_id from orderitems where order_id=:o"), {"o": order_id})]
    if not pids:
        pids = [-1]
    q = lambda sql, **kw: [tuple(r) for r in c.execute(text(sql), {"p": pids, "o": order_id, **kw})]
    return {
        "variants": q('select "variantId", stock_quantity from variants where product_id = any(:p) order by 1'),
        "products": q('select "productId", stock_quantity from products where "productId" = any(:p) order by 1'),
        "offcuts": q('select "offcutId", quantity, status, length, width, height, source_item_id from offcuts where product_id = any(:p) and quantity > 0 order by 1'),
        "pieces": q('select piece_id, state, consumed_by_item_id, offcut_row_id, superseded_by_piece_id from offcut_pieces where product_id = any(:p) order by 1'),
        "items": [(i, p, v, tp, cc, str(ca)[:19], json.dumps(d, sort_keys=True, default=str), pos) for (i, p, v, tp, cc, ca, d, pos) in
                  q('select item_id, product_id, variant_id, total_price, cutting_completed, cutting_completed_at, details, position from orderitems where order_id=:o order by 1')],
        "order": q('select subtotal, total, discount, status, "amountPayed", balance, payment_status from orders where "orderId"=:o'),
        "credit": q('select amount, amount_due, status from credits where "orderId"=:o order by 1'),
        "containers": q('select id, units_sold, status from open_containers where product_id = any(:p) order by 1'),
    }


def diff(a, b):
    out = []
    for k in a:
        if k == "pieces":
            before = {r[0]: r for r in a[k]}
            for r in b[k]:
                if r[0] not in before:
                    if r[1] != "retired":
                        out.append(f"piece {r[0]} created by the change is still {r[1]}")
                elif before[r[0]] != r:
                    out.append(f"piece {r[0]}: {before[r[0]][1:]} -> {r[1:]}")
            continue
        if a[k] != b[k]:
            sa, sb = set(a[k]), set(b[k])
            out.append(f"{k}: gone {sorted(sa - sb)[:3]} | new {sorted(sb - sa)[:3]}")
    return out


def pool_shape(db, order_id):
    s = snapshot(db, order_id)
    return (s["variants"], sorted(Counter((o[3], o[4], o[5], o[2]) for o in s["offcuts"] for _ in range(o[1])).items()))


def edit_once(db, order_id, user):
    order = db.get(Order, order_id)
    resp = orderService.get_order_by_orderId(order_id, db)
    target = next((i for i in resp.items if (i.details or {}).get("lineItems")), None)
    if target is None:
        return None
    items = []
    for i in resp.items:
        req = frontend_request(i)
        if i.itemId == target.itemId:
            req = req.model_copy(update={"quantity": req.quantity + 1})
        items.append(req)
    plan = orderService.get_reversal_plan(order_id, db, user, incoming_items=items)
    answers = default_answers(plan)
    req = edit_request(order, items, answers, plan.get("plan_token"))
    with operation(db, "edit", actor=user, order_id=order_id, request=req.model_dump(mode="json")) as op:
        orderService.apply_order_edit(order_id, req, db, user)
    db.commit()
    return op.op_id, answers


def check(order_id, user):
    problems = []
    # edit + undo
    with live_session() as db:
        before = snapshot(db, order_id)
        res = edit_once(db, order_id, user)
        if res is None:
            return None
        op_id, _ = res
        undo_engine.undo_operation(db, op_id, actor=user, reason="audit", money_handled=False)
        db.commit()
        problems += [f"edit+undo: {d}" for d in diff(before, snapshot(db, order_id))]
    # cancel + undo
    with live_session() as db:
        order = db.get(Order, order_id)
        before = snapshot(db, order_id)
        plan = rp.build_plan(db, order)
        with operation(db, "cancel", actor=user, order_id=order_id, request={}) as op:
            orderService.apply_cancel(order_id, db, user, cut_confirmations=default_answers(plan),
                                      enforce_window=False)
        db.commit()
        undo_engine.undo_operation(db, op.op_id, actor=user, reason="audit", money_handled=False)
        db.commit()
        problems += [f"cancel+undo: {d}" for d in diff(before, snapshot(db, order_id))]
    # edit + correct (same answers) ends where the edit alone ended
    with live_session() as db:
        op_id, answers = edit_once(db, order_id, user)
        after_edit = pool_shape(db, order_id)
        undo_engine.correct_operation(db, op_id, actor=user, reason="audit", cut_confirmations=answers)
        db.commit()
        if pool_shape(db, order_id) != after_edit:
            problems.append("edit+correct(same answers) ended somewhere else than the edit")
    return problems


def main():
    with live_session() as db:
        user = Manager(db.exec(select(User)).first().userId)
        wanted = [int(a) for a in sys.argv[1:] if a.isdigit()]
        ids = wanted or [o.orderId for o in db.exec(select(Order).where(
            Order.status.not_in(["cancelled", "completed"])).order_by(Order.orderId)).all()]
    tally, failures = Counter(), []
    for oid in ids:
        try:
            res = check(oid, user)
        except Exception as e:  # a refusal or crash is a finding too
            detail = getattr(e, "detail", None) or getattr(e, "reasons", None) or str(e)
            failures.append((oid, f"RAISED {type(e).__name__}: {str(detail)[:200]}"))
            tally["raised"] += 1
            continue
        if res is None:
            tally["n/a"] += 1
        elif res:
            tally["problems"] += 1
            failures += [(oid, p) for p in res]
        else:
            tally["ok"] += 1
    print("UNDO AUDIT (every change rolled back):", dict(tally))
    for oid, p in failures:
        print(f"  order {oid}: {p}")


if __name__ == "__main__":
    main()
