"""
Live audit of order edit / cancel — every order in the database, nothing persisted.

Each check runs the REAL service code (update_order, _restore_and_cancel, the reversal plan)
against real orders inside live_rollback.live_session(), so the database is exactly as it
was afterwards. The edit requests are built the way the frontend builds them:
SalesDashboard maps OrderResponse items into cart items, OrderContext.mapItemForBackend
turns those into the request, and the whole thing goes through a JSON round trip.

Checks per order:
  identity edit    submit the order unchanged -> nothing may be reversed, no stock or
                   offcut may move, every item keeps its id and cutting status
  one-item edit    touch one item -> only that item is replaced; the rest keep their ids,
                   cutting status and consumption record; positions follow the cart
  cancel           confirm every cut line with its prefilled answer -> must not raise

    python audit_edit_live.py            # all orders
    python audit_edit_live.py 190 71     # just these
"""
import json
import sys
import traceback
from collections import Counter

from sqlmodel import Session, select

from db.database import engine
from entities.offcuts import Offcut
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.products import Product
from entities.users import User
from entities.variants import Variant

from core.inventory import reversalPlan as rp
from core.ordering import model, orderService
from live_rollback import live_session


class Manager:
    role = "manager"
    username = "live-audit"

    def __init__(self, user_id):
        self.userId = user_id


# ── The frontend round trip ───────────────────────────────────────────────────

def as_browser(value):
    """A value after FastAPI -> JSON -> JavaScript -> JSON -> Python.

    JavaScript has one number type, so a whole-number float the backend stored (1650.0)
    comes back as an int (1650). A Python-only json round trip keeps the float, which is
    how this audit once passed while every half-sheet glass item failed to match live.
    """
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: as_browser(v) for k, v in value.items()}
    if isinstance(value, list):
        return [as_browser(v) for v in value]
    return value


def frontend_request(resp_item) -> model.OrderItemRequest:
    """SalesDashboard (edit mode) -> cart item -> OrderContext.mapItemForBackend."""
    details = as_browser(json.loads(json.dumps(resp_item.details or {}, default=str)))
    details["_sourceItemId"] = resp_item.itemId   # SalesDashboard, edit mode
    unit = resp_item.unitType if resp_item.unitType is not None else details.get("unitType", "pcs")
    qty = resp_item.quantity if resp_item.quantity is not None else details.get("quantity", 1)
    price = resp_item.unitPrice if resp_item.unitPrice is not None else details.get("unitPrice", 0)
    # mapItemForBackend: parseFloat(item.qty || item.quantity), NaN -> 1
    try:
        q = float(qty) if qty else None
    except (TypeError, ValueError):
        q = None
    return model.OrderItemRequest(
        productId=resp_item.productId,
        variantId=resp_item.variantId,
        quantity=q if q else 1,
        unitPrice=float(price or 0),
        unitType=unit or "pcs",
        details=details,
    )


def edit_request(order, items, confirmations=None, token=None) -> model.OrderEditRequest:
    return model.OrderEditRequest(
        customerId=order.customerid, customerName=order.customer_name,
        amountPaid=0.0, servedBy=order.servedby, VAT_status=order.VAT_status,
        discount=order.discount or 0.0, paymentStatus=order.payment_status,
        items=items, cutConfirmations=confirmations, planToken=token,
    )


def default_answers(plan) -> dict:
    """What an operator accepting every prefill would submit. UNKNOWN has no safe prefill,
    so it is answered 'not cut' — the answer that lets the chain decide."""
    out = {}
    for line in plan["lines"]:
        if line.get("will_reverse") is False:
            continue
        state = line["default_physical_state"]
        if state == rp.PHYS_UNKNOWN:
            state = rp.PHYS_NOT_CUT
        out[line["line_ref"]] = {
            "physicalState": state,
            "resolution": rp.RES_RETURN_TO_POOL if state == rp.PHYS_ALREADY_CUT else None,
        }
    return out


# ── Snapshots ─────────────────────────────────────────────────────────────────

def stock_snapshot(db, product_ids):
    out = {}
    for pid in product_ids:
        p = db.get(Product, pid)
        out[("p", pid)] = p.stock_quantity if p else None
        for v in db.exec(select(Variant).where(Variant.product_id == pid)).all():
            out[("v", v.variantId)] = v.stock_quantity
        rows = db.exec(select(Offcut).where(Offcut.product_id == pid, Offcut.quantity > 0)).all()
        out[("pool", pid)] = sorted((round(r.length or 0, 4), round(r.width or 0, 1),
                                     round(r.height or 0, 1), r.status, r.quantity) for r in rows)
    return out


def item_state(db, order_id):
    rows = db.exec(select(OrderItem).where(OrderItem.order_id == order_id)).all()
    return {r.item_id: (r.product_id, r.cutting_completed, r.cutting_completed_at, r.position,
                        json.dumps([l.get("offcut_sources") for l in (r.details or {}).get("lineItems") or []
                                    if isinstance(l, dict)], sort_keys=True, default=str))
            for r in rows}


# ── Checks ────────────────────────────────────────────────────────────────────

def check_identity_edit(order_id, user):
    problems = []
    with live_session() as db:
        order = db.get(Order, order_id)
        resp = orderService.get_order_by_orderId(order_id, db)
        items = [frontend_request(i) for i in resp.items]
        product_ids = {i.productId for i in resp.items}
        before_stock, before_items = stock_snapshot(db, product_ids), item_state(db, order_id)

        plan = orderService.get_reversal_plan(order_id, db, user, incoming_items=items)
        reversing = [l["item_id"] for l in plan["lines"] if l["will_reverse"]]
        if reversing:
            problems.append(f"identity edit would reverse items {reversing}")

        orderService.update_order(order_id, edit_request(order, items, token=plan.get("plan_token")),
                                  db, user)
        db.expire_all()
        after_stock, after_items = stock_snapshot(db, product_ids), item_state(db, order_id)
        if after_stock != before_stock:
            moved = [k for k in before_stock if before_stock[k] != after_stock.get(k)]
            problems.append(f"identity edit moved stock: {moved[:4]}")
        if set(after_items) != set(before_items):
            problems.append(f"identity edit replaced rows: {sorted(before_items)} -> {sorted(after_items)}")
        else:
            for iid, b in before_items.items():
                a = after_items[iid]
                if (a[1], a[2]) != (b[1], b[2]):
                    problems.append(f"item {iid} cutting status changed {b[1:3]} -> {a[1:3]}")
                if a[4] != b[4]:
                    problems.append(f"item {iid} consumption record changed")
    return problems


def check_one_item_edit(order_id, user):
    """Touch the first item that carries lineItems (its top-level quantity doesn't drive
    stock, so re-cutting the same lines can't fail on an empty shelf)."""
    problems = []
    with live_session() as db:
        order = db.get(Order, order_id)
        resp = orderService.get_order_by_orderId(order_id, db)
        if len(resp.items) < 2:
            return None
        target = next((i for i in resp.items if (i.details or {}).get("lineItems")), None)
        if target is None:
            return None

        items = []
        for i in resp.items:
            req = frontend_request(i)
            if i.itemId == target.itemId:
                req = req.model_copy(update={"quantity": req.quantity + 1})
            items.append(req)
        before_items = item_state(db, order_id)

        plan = orderService.get_reversal_plan(order_id, db, user, incoming_items=items)
        # A set: one item can carry several cut lines (glass packs every cut of an item
        # into one sheet), and each line reports its own will_reverse.
        reversing = sorted({l["item_id"] for l in plan["lines"] if l["will_reverse"]})
        target_has_cuts = any(l["item_id"] == target.itemId for l in plan["lines"])
        if target_has_cuts and reversing != [target.itemId]:
            problems.append(f"plan reverses {reversing}, expected only [{target.itemId}]")
        if not target_has_cuts and reversing:
            problems.append(f"plan reverses {reversing}, expected nothing")

        orderService.update_order(
            order_id, edit_request(order, items, default_answers(plan), plan.get("plan_token")), db, user)
        db.expire_all()
        after = item_state(db, order_id)

        kept = [iid for iid in before_items if iid != target.itemId]
        for iid in kept:
            if iid not in after:
                problems.append(f"untouched item {iid} was replaced")
                continue
            b, a = before_items[iid], after[iid]
            if (a[1], a[2]) != (b[1], b[2]):
                problems.append(f"untouched item {iid} cutting status changed {b[1:3]} -> {a[1:3]}")
            if a[4] != b[4]:
                problems.append(f"untouched item {iid} consumption record changed")
        if target.itemId in after:
            problems.append(f"touched item {target.itemId} was not replaced")

        resp2 = orderService.get_order_by_orderId(order_id, db)
        got = [i.productId for i in resp2.items]
        want = [i.productId for i in items]
        if got != want:
            problems.append(f"order no longer reports cart order: {got} vs {want}")
    return problems


def _piece_key(length=0.0, width=None, height=None):
    return (round(length or 0, 2), round(width or 0, 0), round(height or 0, 0))


def _pool_pieces(db, product_ids) -> Counter:
    """Every physical piece in the offcut pool for these products, as a multiset."""
    out = Counter()
    for pid in product_ids:
        for r in db.exec(select(Offcut).where(Offcut.product_id == pid, Offcut.quantity > 0)).all():
            out[_piece_key(r.length, r.width, r.height)] += r.quantity
    return out


def _cut_pieces(order) -> Counter:
    """The pieces this order's cuts physically produced — what an already-cut reversal must
    put in the pool. 1D: each source's length_used. 2D: every cut on every event, owning or
    shared (a shared event's pieces are real glass too)."""
    out = Counter()
    for it in order.orderItems:
        for line in (it.details or {}).get("lineItems") or []:
            if not isinstance(line, dict):
                continue
            for src in line.get("offcut_sources") or []:
                if "cuts" in src:
                    for c in src.get("cuts") or []:
                        out[_piece_key(0, c.get("width"), c.get("height"))] += 1
                elif float(src.get("length_used") or 0) > 0:
                    out[_piece_key(float(src["length_used"]))] += 1
    return out


def _variant_stock(db, order):
    out = {}
    for it in order.orderItems:
        if it.variant_id:
            v = db.get(Variant, it.variant_id)
            out[v.variantId] = v.stock_quantity
    return out


def check_cancel_already_cut(order_id, user):
    """Every cut line answered ALREADY CUT. Exact invariant: the stock that comes back must
    equal what comes back when the cut lines never existed — a cut bar or sheet is in pieces,
    so it can never be returned to stock whole. Catches the phantom-unit bugs (legacy cuts
    ignoring the answer; a shared sheet recombined because one of its lines said 'not cut')."""
    from sqlalchemy.orm.attributes import flag_modified

    with live_session() as db:
        order = db.get(Order, order_id)
        if order.status == "cancelled":
            return None
        plan = rp.build_plan(db, order)
        if not plan["lines"]:
            return None
        # Only products with cut lines: an accessory's loose-piece row (a COUNT stored in
        # `length`) moves on its own restore and would read as a spurious piece here.
        product_ids = {it.product_id for it in order.orderItems
                       if any(isinstance(l, dict) and l.get("offcut_sources")
                              for l in (it.details or {}).get("lineItems") or [])}
        pool_before = _pool_pieces(db, product_ids)
        expected_pieces = _cut_pieces(order)
        before = _variant_stock(db, order)
        answers = {l["line_ref"]: {"physicalState": rp.PHYS_ALREADY_CUT,
                                   "resolution": rp.RES_RETURN_TO_POOL} for l in plan["lines"]}
        orderService._restore_and_cancel(db, order, user,
                                         cut_decisions=rp.validate_decisions(plan, answers))
        db.flush()
        db.expire_all()
        order = db.get(Order, order_id)
        got = {k: db.get(Variant, k).stock_quantity - v for k, v in before.items()}
        pool_after = _pool_pieces(db, product_ids)

    # Pieces gained minus pieces lost must be exactly the pieces that were cut. A cut offcut
    # recombined back into its parent (one long piece instead of the cut + its remainder) or
    # a sharing line's pieces dropped both show up here, though neither changes total length.
    net = Counter(pool_after)
    net.subtract(pool_before)
    net = {k: v for k, v in net.items() if v}
    want_net = {k: v for k, v in expected_pieces.items() if v}
    # The pool files a piece under an existing row within 1mm (OFFCUT_MATCH_TOLERANCE_MM), so a
    # 304x609 cut piece lands in a 305x610 row. Match within that tolerance before comparing.
    for key in list(want_net):
        if net.get(key) == want_net[key]:
            continue
        for other in list(net):
            if other != key and len(other) == len(key) and all(
                    abs(float(a or 0) - float(b or 0)) <= 1.0 for a, b in zip(other, key)):
                moved = min(net[other], want_net[key] - net.get(key, 0))
                if moved > 0:
                    net[other] -= moved
                    net[key] = net.get(key, 0) + moved
        net = {k: v for k, v in net.items() if v}
    problems = []
    if net != want_net:
        extra = {k: v for k, v in net.items() if want_net.get(k, 0) != v}
        missing = {k: v for k, v in want_net.items() if net.get(k, 0) != v}
        problems.append(f"already-cut cancel: pool changed by {extra} but the cut pieces were {missing}")

    with live_session() as db:
        order = db.get(Order, order_id)
        for it in list(order.orderItems):
            lines = [l for l in (it.details or {}).get("lineItems") or []
                     if not (isinstance(l, dict) and l.get("offcut_sources"))]
            if len(lines) == len((it.details or {}).get("lineItems") or []):
                continue
            if not lines:
                # Drop the item outright. Left with an EMPTY lineItems list it would be read
                # as a plain-quantity item and restore details.quantity whole units, which
                # made this baseline wrong in the opposite direction.
                db.delete(it)
                continue
            it.details = {**it.details, "lineItems": lines}
            flag_modified(it, "details")
            db.add(it)
        db.flush()
        db.expire(order)
        before = _variant_stock(db, order)
        orderService._restore_and_cancel(db, order, user, cut_decisions=None)
        db.flush()
        db.expire_all()
        want = {k: db.get(Variant, k).stock_quantity - v for k, v in before.items()}

    # A variant whose only item was dropped from the baseline gets nothing back there.
    diff = {k: (got[k], want.get(k, 0)) for k in got if abs(got[k] - want.get(k, 0)) > 1e-9}
    if diff:
        problems.append(f"already-cut cancel returned stock for cut material {diff}")
    return problems


def check_cancel(order_id, user):
    with live_session() as db:
        order = db.get(Order, order_id)
        if order.status == "cancelled":
            return None
        plan = rp.build_plan(db, order)
        decisions = rp.validate_decisions(plan, default_answers(plan))
        orderService._restore_and_cancel(db, order, user, cut_decisions=decisions)
        db.flush()
    return []


def main():
    wanted = [int(a) for a in sys.argv[1:] if a.isdigit()]
    with Session(engine) as db:
        user = Manager(db.exec(select(User.userId)).first())
        ids = wanted or [o for o in db.exec(select(Order.orderId).order_by(Order.orderId)).all()]
        statuses = {o.orderId: o.status for o in db.exec(select(Order)).all()}
        # --real-only skips orders made up entirely of the fixtures that test_offcut_logic.py
        # and test_glass_offcut_logic.py write straight into this database ("Test ..."
        # products). Their items carry details={"lineItems": [...]} only, a shape no real
        # checkout produces.
        if "--real-only" in sys.argv:
            test_pids = {p.productId for p in db.exec(select(Product)).all()
                         if (p.name or "").startswith("Test ")}
            real = []
            for oid in ids:
                pids = {i.product_id for i in db.exec(
                    select(OrderItem).where(OrderItem.order_id == oid)).all()}
                if pids and not pids <= test_pids:
                    real.append(oid)
            ids = real

    tally = Counter()
    failures = []
    for oid in ids:
        if statuses.get(oid) == "cancelled":
            tally["skipped (cancelled)"] += 1
            continue
        for name, fn in (("identity edit", check_identity_edit),
                         ("one-item edit", check_one_item_edit),
                         ("cancel", check_cancel),
                         ("cancel all-cut", check_cancel_already_cut)):
            if not name.startswith("cancel") and statuses.get(oid) == "completed":
                continue
            try:
                result = fn(oid, user)
            except Exception as e:
                detail = getattr(e, "detail", None) or str(e)
                failures.append((oid, name, f"RAISED {type(e).__name__}: {detail}"))
                tally[f"{name}: raised"] += 1
                if "--trace" in sys.argv:
                    traceback.print_exc()
                continue
            if result is None:
                tally[f"{name}: n/a"] += 1
            elif result:
                tally[f"{name}: problems"] += 1
                failures.extend((oid, name, p) for p in result)
            else:
                tally[f"{name}: ok"] += 1

    print("\nLIVE EDIT/CANCEL AUDIT  (every change rolled back)")
    print("=" * 72)
    for k, v in sorted(tally.items()):
        print(f"  {k:28s} {v}")
    if failures:
        print(f"\n{len(failures)} problem(s):")
        for oid, name, p in failures:
            print(f"  order {oid:4d}  {name:14s} {p}")
    else:
        print("\nNo problems.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
