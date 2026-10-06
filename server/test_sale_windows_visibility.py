"""Sale windows: an open ("held") or closed ("abandoned") window is never an order.

Route sweep (plan T1). Every API route that takes an order id is called with a held and
an abandoned order and must answer 404, leaving both untouched; every listing, report and
queue must leave them out; the financial summary must not move. The routes are ENUMERATED
from the app, so an order endpoint added later is swept too — and fails here until it is
given a request body below (so nobody can add one without deciding how it treats windows).

Runs on emiratesco_edit_test (DATABASE_URL), after the seed. Run from server/.
"""
import logging
import os
import sys
import uuid

sys.path.insert(0, os.getcwd())
logging.disable(logging.CRITICAL)

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlmodel import Session, select, text

import entities  # noqa: F401
from db.database import engine
from entities.credits import Credit
from entities.customers import Customer
from entities.opJournal import StockOperation
from entities.orderItems import OrderItem
from entities.orders import Order
from entities.payments import Payment
from entities.products import Product
from entities.saleWindows import SaleWindow
from entities.users import User
from entities.variants import Variant

failures = []


def check(label, ok, got=None):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f" — got {got!r}"))
    if not ok:
        failures.append(label)


with Session(engine) as db:
    assert db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test", "test DB only"

import main  # noqa: E402  (after the DB check)
from core.userManagement import authService  # noqa: E402

from core.userManagement.model import TokenData  # noqa: E402

USERS, TOKENS = {}, {}
with Session(engine) as db:
    for role in ("ceo", "manager", "cashier", "admin"):
        USERS[role] = db.exec(select(User).where(User.username == f"qa_{role}")).one()
        # The same shape get_current_user returns (userId as a string).
        TOKENS[role] = TokenData(userId=str(USERS[role].userId), username=USERS[role].username, role=role)
current = {"user": TOKENS["ceo"]}
main.app.dependency_overrides[authService.get_current_user] = lambda: current["user"]
main.app.dependency_overrides[authService.get_current_user_allow_pending] = lambda: current["user"]
client = TestClient(main.app)
ROLE_ORDER = ("ceo", "manager", "cashier", "admin")


def call(method, path, **kw):
    """Call as the first role allowed through (403 = try the next one)."""
    resp = None
    for role in ROLE_ORDER:
        current["user"] = TOKENS[role]
        resp = client.request(method, path, **kw)
        if resp.status_code != 403:
            return resp
    return resp


# ── Fixtures ─────────────────────────────────────────────────────────────────
TAG = uuid.uuid4().hex[:6]
with Session(engine) as db:
    widget = db.exec(select(Product).where(Product.name == "QA Widget")).one()
    wvar = db.exec(select(Variant).where(Variant.product_id == widget.productId)).first()
    biz = db.exec(select(Customer).where(Customer.name == "QA Business")).one()
    cashier = USERS["cashier"]

    def make(status, name):
        o = Order(servedby=cashier.userId, status=status, payment_status="Unpaid", customerid=biz.customerId,
                  customer_name=name, subtotal=100.0, total=100.0, balance=100.0, amountPayed=0.0, discount=0.0)
        db.add(o)
        db.flush()
        db.add(OrderItem(order_id=o.orderId, product_id=widget.productId, variant_id=wvar.variantId,
                         total_price=100.0, position=0, cutting_completed=False,
                         details={"quantity": 1, "unitType": "pcs", "unitPrice": 100}))
        db.flush()
        return o

    from core.financials.PaymentService import get_financial_summary
    summary_before = get_financial_summary("day", None, db).model_dump()

    held = make("held", f"Held {TAG}")
    abandoned = make("abandoned", f"Abandoned {TAG}")
    db.add(SaleWindow(order_id=held.orderId, user_id=cashier.userId, label="Window 1"))
    db.add(SaleWindow(order_id=abandoned.orderId, user_id=cashier.userId, label="Window 2",
                      closed_at=held.created_at, close_reason="released"))
    op = StockOperation(op_id=uuid.uuid4().hex, kind="window_cart", order_id=held.orderId, summary={})
    db.add(op)
    db.commit()
    H, A, OP = held.orderId, abandoned.orderId, op.op_id
    H_ITEM = db.exec(select(OrderItem).where(OrderItem.order_id == H)).one().item_id
    A_ITEM = db.exec(select(OrderItem).where(OrderItem.order_id == A)).one().item_id
    CUST = biz.customerId
    widget_id, widget_vid = widget.productId, wvar.variantId

# A cancel PIN, so the cancel route gets past the PIN to the order lookup.
current["user"] = TOKENS["ceo"]
r = client.put("/settings/cancel-pin", json={"pin": "2468", "currentPassword": "Test1234!"})
assert r.status_code in (200, 201), r.text


def snapshot():
    with Session(engine) as db:
        rows = []
        for oid in (H, A):
            o = db.get(Order, oid)
            rows.append((o.status, o.total, o.balance, o.amountPayed, o.payment_status, o.order_no))
            rows.append(tuple((i.item_id, i.cutting_completed, str(i.details), i.total_price)
                              for i in db.exec(select(OrderItem).where(OrderItem.order_id == oid)).all()))
        rows.append(len(db.exec(select(Payment).where(Payment.orderId.in_([H, A]))).all()))
        rows.append(len(db.exec(select(Credit).where(Credit.orderId.in_([H, A]))).all()))
        return rows


before = snapshot()
item_req = {"productId": 1, "variantId": None, "quantity": 1, "unitType": "pcs", "unitPrice": 100,
            "details": {"quantity": 1}}

# Body for every route with an {order_id}; None = no body. A new order route without an
# entry here fails the sweep: decide how it treats windows, then add it.
BODIES = {
    ("GET", "/orders/{order_id}"): None,
    ("GET", "/orders/{order_id}/reversal-plan"): None,
    ("POST", "/orders/{order_id}/reversal-plan"): {"items": []},
    ("PUT", "/orders/{order_id}/edit"): {"servedBy": str(USERS["cashier"].userId), "items": [item_req]},
    ("PUT", "/orders/{order_id}/correct-offcut"): {"item_id": 0, "line_idx": 0, "event_idx": 0, "new_remainders": []},
    ("PUT", "/orders/{order_id}/correct-profile-offcut"): {"item_id": 0, "line_idx": 0, "event_idx": 0},
    ("POST", "/orders/{order_id}/correct-offcut/preview"): {"item_id": 0, "line_idx": 0, "event_idx": 0, "new_remainders": []},
    ("POST", "/orders/{order_id}/correct-profile-offcut/preview"): {"item_id": 0, "line_idx": 0, "event_idx": 0},
    ("PUT", "/orders/{order_id}/mark-cutting-done"): None,
    ("PUT", "/orders/{order_id}/workflow-status"): None,
    ("PUT", "/orders/{order_id}/cancel"): {"pin": "2468"},
    ("POST", "/orders/{order_id}/items/{item_id}/projected-offcuts"): {"answers": {}},
    ("GET", "/orders/{order_id}/operations"): None,
    ("GET", "/orders/{order_id}/items"): None,
    ("GET", "/financials/payments/order/{order_id}"): None,
    ("PUT", "/financials/credits/{order_id}"): {"amount_due": 0, "status": "Paid"},
}
QUERY = {"/orders/{order_id}/workflow-status": {"new_status": "ready"},
         "/financials/credits/{order_id}": {"amount": 1}}

print("1. Every route taking an order id refuses a held and an abandoned window (404)")
swept = 0
for route in main.app.routes:
    if not isinstance(route, APIRoute) or "{order_id}" not in route.path:
        continue
    for method in route.methods:
        key = (method, route.path)
        if key not in BODIES:
            check(f"{method} {route.path} has a sweep entry (add one to BODIES)", False, "missing")
            continue
        for label, oid, item in (("held", H, H_ITEM), ("abandoned", A, A_ITEM)):
            path = route.path.replace("{order_id}", str(oid)).replace("{item_id}", str(item))
            body = BODIES[key]
            if isinstance(body, dict) and "item_id" in body:
                body = {**body, "item_id": item}
            resp = call(method, path, json=body, params=QUERY.get(route.path))
            check(f"{method} {route.path} [{label}] -> 404", resp.status_code == 404, (resp.status_code, resp.text[:120]))
            swept += 1
check("swept at least 30 route calls", swept >= 30, swept)

print("2. Operations of a window can't be undone or corrected")
for method, path, body in (("POST", f"/orders/operations/{OP}/undo-preview", None),
                           ("POST", f"/orders/operations/{OP}/undo", {"pin": "2468", "reason": "test"}),
                           ("GET", f"/orders/operations/{OP}/correction-plan", None),
                           ("POST", f"/orders/operations/{OP}/correct-preview", {"cutConfirmations": {}}),
                           ("POST", f"/orders/operations/{OP}/correct", {"pin": "2468", "reason": "test", "cutConfirmations": {}})):
    resp = call(method, path, json=body)
    # A preview answers 200 with undoable=false and its reasons; anything else must be a 4xx.
    refused = (resp.status_code >= 400 and resp.status_code != 500) or (
        resp.status_code == 200 and path.endswith("preview") and resp.json().get("undoable") is False
        and any("sale window" in r for r in resp.json().get("reasons") or []))
    check(f"{method} {path.replace(OP, '{op}')} refused", refused, (resp.status_code, resp.text[:160]))

print("3. Ids passed in a request body are refused too")
resp = call("POST", "/financials/payments", json={"orderId": H, "amount": 10, "paymentMethod": "cash"})
check("payment against a held window -> 404", resp.status_code == 404, (resp.status_code, resp.text[:120]))
resp = call("POST", "/financials/credits", json={"orderId": H, "customerId": CUST, "amount": 100, "amount_due": 100, "status": "Pending"})
# The manual credit route was removed (BACKEND_AUDIT_PLAN C6): refused outright now.
check("credit against a held window -> refused (route removed: 405)", resp.status_code in (404, 405), (resp.status_code, resp.text[:120]))
resp = call("PUT", "/orders/cutting-queue/mark-done", json={"item_ids": [H_ITEM, A_ITEM]})
check("marking a window's items cut does nothing", resp.status_code < 500, resp.status_code)
resp = call("PUT", "/orders/cutting-queue/mark-orders-done", json={"order_ids": [H, A]})
check("marking a window's order cut does nothing", resp.status_code < 500, resp.status_code)
resp = call("POST", "/orders/", json={"servedBy": str(USERS["cashier"].userId), "status": "held",
                                     "items": [item_req], "amountPaid": 0})
check("an order can't be created as 'held'", resp.status_code == 422, (resp.status_code, resp.text[:120]))
with Session(engine) as db:
    confirmed = db.exec(select(Order).where(Order.status.notin_(("held", "abandoned")))).first()
if confirmed is not None:
    resp = call("PUT", f"/orders/{confirmed.orderId}/workflow-status", params={"new_status": "held"})
    check("an order can't be set to 'held'", resp.status_code in (400, 422), (resp.status_code, resp.text[:120]))

print("4. Listings, reports and queues leave windows out")


def mentions(payload, ids):
    """Does the JSON name one of `ids` under an order-id key?"""
    keys = {"orderId", "order_id", "orderID"}
    if isinstance(payload, dict):
        for k, v in payload.items():
            if k in keys and v in ids:
                return True
            if mentions(v, ids):
                return True
    elif isinstance(payload, list):
        return any(mentions(v, ids) for v in payload)
    return False


LISTS = [
    "/orders/", f"/orders/?search=Held%20{TAG}", f"/orders/?search=Abandoned%20{TAG}",
    "/orders/with-balance", "/orders/cutting-queue", f"/orders/customer/{CUST}",
    "/orders/audit/history", "/financials/credits/outstanding", f"/financials/credits/customer/{CUST}",
    "/open-containers/utilization", "/financials/summary?period=day",
]
for path in LISTS:
    resp = call("GET", path)
    ok = resp.status_code == 200 and not mentions(resp.json(), {H, A})
    check(f"GET {path} leaves windows out", ok, (resp.status_code, resp.text[:120]))

with Session(engine) as db:
    from core.ordering import orderService as osvc
    from datetime import date
    today = date.today().isoformat()
    for label, rows in (
        ("by served-by", osvc.get_orders_by_servedby(cashier.userId, db, 0, 500)),
        ("for a day", osvc.get_orders_for_certain_day(today, db)),
        ("VAT excluded period", osvc.get_orders_for_period_vatExcluded(f"{today} 00:00:00", f"{today} 23:59:59", db, 0, 500)),
        ("all VAT included", osvc.getAll_orders_VatIncluded(db)),
    ):
        ids = {r.orderId for r in rows}
        check(f"service listing {label} leaves windows out", not ids & {H, A}, ids & {H, A})

print("5. The financial summary doesn't move")
with Session(engine) as db:
    summary_after = get_financial_summary("day", None, db).model_dump()
check("day summary identical with windows present", summary_after == summary_before,
      {k: (summary_before.get(k), summary_after.get(k)) for k in summary_after if summary_after.get(k) != summary_before.get(k)})

print("7. Order numbers: looked up and searched by the number people see (T28, server side)")
resp = call("POST", "/orders/", json={"servedBy": str(USERS["cashier"].userId), "status": "confirmed",
                                     "customerId": CUST, "items": [{**item_req, "productId": widget_id, "variantId": widget_vid}],
                                     "amountPaid": 0})
check("a checkout to look up", resp.status_code == 200, (resp.status_code, resp.text[:150]))
if resp.status_code == 200:
    oid, ono = resp.json()["orderId"], resp.json()["orderNo"]
    check("its number is not its internal id (seed offsets numbers by 1000)", ono is not None and ono != oid, (oid, ono))
    r = call("GET", f"/orders/by-number/{ono}")
    check("GET /orders/by-number/<no> finds it", r.status_code == 200 and r.json()["orderId"] == oid, (r.status_code, r.text[:120]))
    r = call("GET", "/orders/", params={"search": f"#{ono}"})
    check("searching '#<no>' finds it", r.status_code == 200 and [o["orderId"] for o in r.json()] == [oid], r.text[:150])
    r = call("GET", f"/orders/by-number/{oid}")
    check("its internal id is not a number anyone can look it up by", r.status_code == 404 or r.json()["orderId"] != oid, r.status_code)
    r = call("PUT", f"/orders/{oid}/workflow-status", params={"new_status": "ready"})
    check("messages name the order by its number", r.status_code == 200 and f"#{ono}" in r.json().get("message", ""), r.text[:150])

print("6. Nothing about either window changed")
check("held and abandoned orders, items, payments, credits untouched", snapshot() == before)

print()
print("ALL PASS" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
