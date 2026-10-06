"""Backend audit fixes (BACKEND_AUDIT_PLAN.md) - each check fails on the code before its fix.

  A1  GET /orders/{id}/items needs a signed-in user
  A2  concurrent debt payments: exactly one succeeds, payments == amountPayed
  A3  a cancel racing a debt payment never loses the payment from the refund
  A4  one quotation converted twice at once -> one order, stock taken once
  A5  the stock-skipping POST /invoices/{id}/convert is retired (410)
  A6  long-number order search / lookup no longer 500s
  A7  a restock racing a sale loses neither
  B2  order lists load in a handful of queries, not one+ per row
  B4  summary and cash-for-a-date match the raw totals (cash-for-a-date always 500'd)
  B5  a stalled WebSocket doesn't hold up a broadcast; closing twice is harmless
  B6  list sizes are capped
  C1  an open pack's age is in Nairobi time
  C2  deleting a user with sales history -> 409, not 500
  C3  a duplicate category -> 400, not 500
  C5  a quotation is priced by the server, not the browser
  C6  the manual credit endpoints are gone

Runs on emiratesco_edit_test (DATABASE_URL), after the QA seed. Run from server/.
"""
import asyncio
import logging
import os
import sys
import threading
import time
import uuid

sys.path.insert(0, os.getcwd())
logging.disable(logging.CRITICAL)

from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session, select, text

import entities  # noqa: F401
from db.database import engine
from entities.customers import Customer
from entities.invoices import Invoice
from entities.orders import Order
from entities.payments import Payment
from entities.products import Product
from entities.users import User
from entities.variants import Variant

with Session(engine) as _db:
    assert _db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test", "test DB only"

import main  # noqa: E402
from core.userManagement import authService  # noqa: E402
from core.userManagement.model import TokenData  # noqa: E402
from core.ordering import model, orderService  # noqa: E402
from core.financials import PaymentService  # noqa: E402
from core.settings.service import set_cancel_pin  # noqa: E402

failures = []


def check(label, ok, got=None):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f" — got {got!r}"))
    if not ok:
        failures.append(label)


USERS, TOKENS = {}, {}
with Session(engine) as db:
    for role in ("cashier", "manager", "ceo", "admin"):
        u = db.exec(select(User).where(User.username == f"qa_{role}")).one()
        USERS[role] = u.userId
        TOKENS[role] = TokenData(userId=str(u.userId), username=u.username, role=role)
    widget = db.exec(select(Product).where(Product.name == "QA Widget")).one()
    wv = db.exec(select(Variant).where(Variant.product_id == widget.productId)).first()
    biz = db.exec(select(Customer).where(Customer.name == "QA Business")).one()
    PID, VID, CUST = widget.productId, wv.variantId, biz.customerId
    set_cancel_pin(db, "2468", TOKENS["ceo"])
    db.commit()

ITEM = model.OrderItemRequest(productId=PID, variantId=VID, quantity=1, unitPrice=100, unitType="pcs",
                              details={"quantity": 1})


def sell(paid=0, invoice=None, user="cashier"):
    with Session(engine) as db:
        return orderService.create_order(model.OrderCreate(
            servedBy=uuid.UUID(TOKENS[user].userId), status="confirmed", customerId=CUST, amountPaid=paid,
            items=[ITEM], sourceInvoiceId=invoice), db, TOKENS[user])


def stock():
    with Session(engine) as db:
        return db.get(Variant, VID).stock_quantity


def parallel(fns):
    out = [None] * len(fns)
    barrier = threading.Barrier(len(fns))

    def run(i, f):
        barrier.wait()
        try:
            out[i] = ("ok", f())
        except Exception as e:
            out[i] = ("err", getattr(e, "status_code", None) or repr(e)[:80])
    ts = [threading.Thread(target=run, args=(i, f)) for i, f in enumerate(fns)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    return out


print("A1. Order items need a signed-in user")
anon = TestClient(main.app)
oid = sell().orderId
check("no token -> 401", anon.get(f"/orders/{oid}/items").status_code == 401, anon.get(f"/orders/{oid}/items").status_code)
main.app.dependency_overrides[authService.get_current_user] = lambda: TOKENS["cashier"]
client = TestClient(main.app)
r = client.get(f"/orders/{oid}/items")
check("signed in -> 200 with the items", r.status_code == 200 and len(r.json()) == 1, r.status_code)

print("A2. Two tills collecting the same debt at once")
oid = sell(paid=0).orderId    # owes 100
res = parallel([lambda: PaymentService.record_payment(oid, 100, "cash", Session(engine), TOKENS["cashier"])
                for _ in range(4)])
oks = [r for r in res if r[0] == "ok"]
check("exactly one of four simultaneous full payments succeeds", len(oks) == 1, res)
with Session(engine) as db:
    o = db.get(Order, oid)
    paid_rows = sum(p.amount for p in db.exec(select(Payment).where(Payment.orderId == oid)).all())
check("payment rows add up to amountPayed (nothing lost)", abs(paid_rows - o.amountPayed) < 0.01 and o.balance == 0,
      (paid_rows, o.amountPayed, o.balance))

print("A3. A cancel racing a debt payment never misses the payment")
for n in range(4):
    oid = sell(paid=0).orderId
    res = parallel([
        lambda: PaymentService.record_payment(oid, 60, "cash", Session(engine), TOKENS["cashier"]),
        lambda: orderService.cancel_order_with_pin(oid, "2468", Session(engine), TOKENS["manager"], refund_method="cash"),
    ])
    with Session(engine) as db:
        o = db.get(Order, oid)
        net = sum(p.amount for p in db.exec(select(Payment).where(Payment.orderId == oid)).all())
    check(f"race {n + 1}: cancelled and every shilling paid was refunded (net 0)",
          o.status == "cancelled" and abs(net) < 0.01, (o.status, net, res))

print("A4. One quotation converted twice at once")
with Session(engine) as db:
    inv = Invoice(customer_id=CUST, customer_name="QA Business", customer_type="registered", created_by=USERS["cashier"],
                  subtotal=100, total=100, items=[{"productId": PID, "variantId": VID, "qty": 1, "totalPrice": 100}],
                  invoice_number=f"Q-{uuid.uuid4().hex[:6]}")
    db.add(inv)
    db.commit()
    INV = inv.invoiceId
before = stock()
res = parallel([lambda: sell(invoice=INV), lambda: sell(invoice=INV)])
check("one conversion succeeds, the other is refused", sorted(r[0] for r in res) == ["err", "ok"], res)
with Session(engine) as db:
    n_orders = len(db.exec(select(Order).where(Order.source_invoice_id == INV)).all())
check("one order for the quotation", n_orders == 1, n_orders)
check("stock taken once", stock() == before - 1, (before, stock()))

print("A5. The stock-skipping conversion route is retired")
r = client.post(f"/invoices/{INV}/convert", json={"amount_paid": 0})
check("POST /invoices/{id}/convert -> 410", r.status_code == 410, r.status_code)

print("A6. Long numbers")
r = client.get("/orders/", params={"search": "254722222222"})
check("searching a 12-digit phone number -> 200", r.status_code == 200, r.status_code)
r = client.get("/orders/by-number/99999999999")
check("looking up an impossible order number -> 422, not 500", r.status_code == 422, r.status_code)

print("A7. A restock racing a sale loses neither")
from core.inventory.products import service as psvc, model as pmodel  # noqa: E402
for n in range(3):
    before = stock()
    res = parallel([lambda: psvc.update_variant(VID, pmodel.VariantUpdate(stock_change=5), Session(engine), TOKENS["manager"]),
                    lambda: sell()])
    check(f"race {n + 1}: stock = before + 5 - 1", stock() == before + 4 and all(r[0] == "ok" for r in res), (before, stock(), res))

print("B2. Order lists load in a handful of queries")
count = {"n": 0}


@event.listens_for(engine, "before_cursor_execute")
def _count(*a, **k):
    count["n"] += 1


for label, fn in (("all orders", lambda db: orderService.get_all_orders(db, 0, 100)),
                  ("with balance", lambda db: orderService.get_orders_with_balance(db)),
                  ("cutting queue", lambda db: orderService.get_pending_cutting_orders(db, TOKENS["manager"]))):
    with Session(engine) as db:
        count["n"] = 0
        rows = fn(db)
        check(f"{label}: {len(rows)} rows in <= 5 queries", count["n"] <= 5, count["n"])
event.remove(engine, "before_cursor_execute", _count)

print("B4. Summary and cash-for-a-date match the raw totals")
with Session(engine) as db:
    today = db.exec(text("select current_date")).one()[0]
    raw = float(db.exec(text("select coalesce(sum(amount),0) from payments where date(payed_at) = current_date")).one()[0])
    summary = PaymentService.get_financial_summary("day", None, db)
    check("day summary total = raw sum of today's payments", abs(summary.total - raw) < 0.01, (summary.total, raw))
    raw_cash = float(db.exec(text("select coalesce(sum(amount),0) from payments where payment_method='cash' and date(payed_at)=current_date")).one()[0])
    got = PaymentService.calculate_cash_payments_for_certain_date(today.isoformat(), db)
    check("cash for a date = raw cash sum (it always failed before)", abs(got - raw_cash) < 0.01, (got, raw_cash))

print("B5. WebSocket broadcasting")
from ws.manager import ConnectionManager  # noqa: E402


class Stalled:
    async def send_text(self, _):
        await asyncio.sleep(30)


class Live:
    def __init__(self):
        self.got = []

    async def send_text(self, payload):
        self.got.append(payload)


mgr = ConnectionManager()
live, stalled = Live(), Stalled()
mgr._connections += [stalled, live]
t0 = time.perf_counter()
asyncio.run(mgr.broadcast("orders_updated"))
took = time.perf_counter() - t0
check("a stalled socket doesn't hold up the others (< 3s)", took < 3 and live.got, round(took, 2))
check("the stalled socket is dropped", stalled not in mgr._connections)
before = list(mgr._connections)
try:
    mgr.disconnect(stalled)   # already pruned by the broadcast: must not raise...
    raised = None
except Exception as e:  # noqa: BLE001
    raised = repr(e)
check("closing an already-dropped socket is harmless (no error, nobody else dropped)",
      raised is None and mgr._connections == before, raised or len(mgr._connections))

print("B6. List sizes are capped")
r = client.get("/orders/", params={"limit": 5000})
check("limit 5000 -> 422", r.status_code == 422, r.status_code)
r = client.get("/orders/with-balance", params={"limit": 1000})
check("limit 1000 still allowed (a cashier may list balances)", r.status_code == 200, r.status_code)
r = client.get("/orders/with-balance", params={"limit": 1001})
check("limit 1001 -> 422", r.status_code == 422, r.status_code)

print("C1. An open pack's age is in Nairobi time")
from core.inventory.openContainers.service import _utilization  # noqa: E402
from entities.openContainers import OpenContainer  # noqa: E402
from config import nairobi_now  # noqa: E402
c = OpenContainer(product_id=PID, variant_id=VID, pool_key="", status="open", nominal_quantity=10, units_sold=0,
                  opened_at=nairobi_now())
hours = _utilization(c).get("duration_hours")
check("a pack opened just now is ~0 h old (was -3 h)", hours is not None and abs(hours) < 0.1, hours)

print("C2. Deleting a user with sales history")
main.app.dependency_overrides[authService.get_current_user] = lambda: TOKENS["ceo"]
r = client.delete(f"/users/{USERS['cashier']}")
check("-> 409 with a reason, not 500", r.status_code == 409 and "Deactivate" in r.text, (r.status_code, r.text[:100]))

print("C3. A duplicate category")
r = client.post("/products/categories", json={"name": "QA Accessories"})
check("-> 400 'already exists', not 500", r.status_code == 400 and "already exists" in r.text, (r.status_code, r.text[:100]))

print("C5. A quotation is priced by the server")
with Session(engine) as db:
    bar = db.exec(select(Product).where(Product.name == "QA Profile Bar")).one()
    bv = db.exec(select(Variant).where(Variant.product_id == bar.productId)).first()
    BAR, BARV = bar.productId, bv.variantId
CUSTOMER = {"id": CUST, "name": "QA Business", "type": "registered"}
widget_line = {"id": PID, "productId": PID, "name": "QA Widget", "qty": 2, "price": 80, "totalPrice": 160,
               "details": {"variantId": VID}}                      # browser says 80 each; the shelf says 100
bar_line = {"id": BAR, "productId": BAR, "name": "QA Profile Bar", "qty": 1, "price": 1, "totalPrice": 1, "unit": "ft",
            "details": {"variantId": BARV, "lineItems": [
                {"type": "full", "label": "Full bar", "qty": 2, "rate": 1, "total": 2},          # 2 x 1950
                {"type": "cut", "label": "Cut", "qty": 1, "rate": 100, "total": 500, "meta": {"length": 5}}]}}  # 5ft x 100
r = client.post("/invoices/", json={"customer": CUSTOMER, "items": [widget_line, bar_line],
                                    "subtotal": 1, "vat_amount": 0, "total": 1, "vat_enabled": True})
body = r.json()
check("saved (200)", r.status_code == 200, (r.status_code, r.text[:200]))
# 200 + (3900 + 500) = 4600; VAT 16% = 736
check("server totals: subtotal 4600, VAT 736, total 5336, 2 lines repriced",
      (body.get("subtotal"), body.get("vat_amount"), body.get("total"), body.get("repriced_lines")) == (4600, 736, 5336, 2), body)
stored = client.get(f"/invoices/{body.get('invoiceId')}").json()
check("stored lines carry the server's prices", [i["totalPrice"] for i in stored["items"]] == [200, 4400],
      [i.get("totalPrice") for i in stored["items"]])
lines = stored["items"][1]["details"]["lineItems"]
check("calculator line totals are the server's too (they print)", [l["total"] for l in lines] == [3900, 500]
      and lines[0]["rate"] == 1950, lines)
check("stored totals match what the lines add up to", (stored["subtotal"], stored["total"]) == (4600, 5336), stored)

r = client.post("/invoices/", json={"customer": CUSTOMER, "items": [dict(widget_line, price=100, totalPrice=200)],
                                    "subtotal": 200, "total": 200})
check("a correctly priced cart is saved unchanged (0 repriced)",
      r.status_code == 200 and r.json()["total"] == 200 and r.json()["repriced_lines"] == 0, r.text[:200])
INV2 = r.json()["invoiceId"]
r = client.put(f"/invoices/{INV2}", json={"total": 1, "subtotal": 1})
check("an update can't overwrite the totals", r.status_code == 200 and r.json()["total"] == 200, r.text[:200])
r = client.put(f"/invoices/{INV2}", json={"vat_enabled": True})
check("turning VAT on reprices: 200 + 32 = 232", r.status_code == 200 and r.json()["total"] == 232, r.text[:200])
r = client.post("/invoices/", json={"customer": CUSTOMER, "items": [{"name": "mystery", "totalPrice": 50}], "total": 50})
check("a line with no product -> 400, not 500", r.status_code == 400 and "no product" in r.text, (r.status_code, r.text[:120]))
r = client.post("/invoices/", json={"customer": CUSTOMER, "items": [dict(widget_line, productId=999999, id=999999)], "total": 50})
check("an unknown product -> 400, not 500", r.status_code == 400, (r.status_code, r.text[:120]))

print("C6. The manual credit endpoints are gone")
r = client.post("/financials/credits", json={"orderId": oid, "customerId": CUST, "amount": 1, "amount_due": 1, "status": "Unpaid"})
check("POST /financials/credits -> 405", r.status_code == 405, r.status_code)
r = client.put(f"/financials/credits/{oid}", params={"amount": 1}, json={"amount_due": 0, "status": "Paid"})
check("PUT /financials/credits/{id} -> 404/405", r.status_code in (404, 405), r.status_code)
r = client.get("/financials/credits/outstanding")
check("outstanding debts still served", r.status_code == 200, r.status_code)

print()
print("ALL PASS" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
