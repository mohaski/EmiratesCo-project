"""Sale windows: a sale confirmed from a window is charged exactly like a normal checkout
(plan T2, T3, T5).

The parity matrix sells the same cart both ways - POST /orders/ (create_order) and a sale
window (open, save cart, confirm) - across VAT, discounts, amounts paid and payment methods,
and requires the resulting order, payment and credit rows to be field-for-field equal, or
both paths to refuse. Any future drift between the two money paths fails here.

Runs on emiratesco_edit_test (DATABASE_URL), after the seed. Run from server/.
"""
import itertools
import logging
import os
import sys
import threading
import uuid

sys.path.insert(0, os.getcwd())
logging.disable(logging.CRITICAL)

from fastapi.testclient import TestClient
from sqlmodel import Session, select, text

import entities  # noqa: F401
from db.database import engine
from entities.credits import Credit
from entities.customers import Customer
from entities.invoices import Invoice
from entities.orders import Order
from entities.payments import Payment
from entities.products import Product
from entities.users import User
from entities.variants import Variant

failures = []


def check(label, ok, got=None):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f" — got {got!r}"))
    if not ok:
        failures.append(label)


with Session(engine) as db:
    assert db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test", "test DB only"

import main  # noqa: E402
from core.userManagement import authService  # noqa: E402
from core.userManagement.model import TokenData  # noqa: E402

with Session(engine) as db:
    cashier = db.exec(select(User).where(User.username == "qa_cashier")).one()
    TOKEN = TokenData(userId=str(cashier.userId), username=cashier.username, role="cashier")
    CASHIER_ID = str(cashier.userId)
    widget = db.exec(select(Product).where(Product.name == "QA Widget")).one()
    wvar = db.exec(select(Variant).where(Variant.product_id == widget.productId)).first()
    wvar.stock_quantity = 100000
    widget.stock_quantity = 100000
    db.add_all([wvar, widget])
    biz = db.exec(select(Customer).where(Customer.name == "QA Business")).one()
    db.exec(text("INSERT INTO system_settings (key, value) VALUES ('sale_windows_enabled', 'true') "
                 "ON CONFLICT (key) DO UPDATE SET value = 'true'"))
    db.commit()
    PID, VID, CUST = widget.productId, wvar.variantId, biz.customerId

main.app.dependency_overrides[authService.get_current_user] = lambda: TOKEN
client = TestClient(main.app)
ITEM = {"productId": PID, "variantId": VID, "quantity": 1, "unitType": "pcs", "unitPrice": 100.0,
        "details": {"quantity": 1, "unitType": "pcs", "unitPrice": 100.0}}


def order_rows(order_id):
    with Session(engine) as db:
        o = db.get(Order, order_id)
        pays = sorted((p.amount, p.payment_method, str(p.payment_details), p.reason)
                      for p in db.exec(select(Payment).where(Payment.orderId == order_id)).all())
        creds = sorted((c.amount, c.amount_due, c.status)
                       for c in db.exec(select(Credit).where(Credit.orderId == order_id)).all())
        return {"subtotal": o.subtotal, "total": o.total, "balance": o.balance, "amountPayed": o.amountPayed,
                "payment_status": o.payment_status, "discount": o.discount, "VAT_status": o.VAT_status,
                "status": o.status, "customer": o.customerid, "payments": pays, "credits": creds}


def via_checkout(vat, discount, paid, method, details, items=None):
    # Exactly what the app's checkout sends (OrderContext.addOrder), status included.
    body = {"servedBy": CASHIER_ID, "status": "confirmed", "customerId": CUST, "VAT_status": vat, "discount": discount,
            "amountPaid": paid, "paymentMethod": method, "paymentDetails": details, "items": items or [ITEM]}
    r = client.post("/orders/", json=body)
    if r.status_code != 200:
        return ("refused", r.status_code // 100)
    return ("sold", order_rows(r.json()["orderId"]))


def open_window():
    r = client.post("/windows/", json={"deviceId": "t2"})
    assert r.status_code == 200, r.text
    return r.json()


def via_window(vat, discount, paid, method, details):
    w = open_window()
    try:
        r = client.put(f"/windows/{w['windowId']}/cart", json={
            "version": w["version"], "customerId": CUST, "VAT_status": vat, "discount": discount, "items": [ITEM]})
        if r.status_code != 200:
            return ("refused", r.status_code // 100)
        w = r.json()
        r = client.post(f"/windows/{w['windowId']}/confirm", json={
            "version": w["version"], "idempotencyKey": uuid.uuid4().hex, "amountPaid": paid,
            "paymentMethod": method, "paymentDetails": details})
        if r.status_code != 200:
            return ("refused", r.status_code // 100)
        return ("sold", order_rows(r.json()["orderId"]))
    finally:
        client.delete(f"/windows/{w['windowId']}")  # a no-op once confirmed; frees stock otherwise


def total_for(vat, discount):
    """The server's total for this cart (from a window save), so 'exact' payments are exact."""
    w = open_window()
    try:
        r = client.put(f"/windows/{w['windowId']}/cart", json={
            "version": w["version"], "customerId": CUST, "VAT_status": vat, "discount": max(discount, 0), "items": [ITEM]})
        return r.json()["total"]
    finally:
        client.delete(f"/windows/{w['windowId']}")


print("1. Same cart, both ways: identical order/payment/credit rows, or both refuse")
combos = 0
for vat, discount in itertools.product((False, True), (0, 30, 250, -5)):
    total = total_for(vat, discount)
    for paid_kind, method_kind in itertools.product(("zero", "partial", "exact", "over_half", "over_5", "negative"),
                                                    ("cash", "mpesa", "split_ok", "split_bad")):
        paid = {"zero": 0, "partial": 40, "exact": total, "over_half": total + 0.5,
                "over_5": total + 5, "negative": -10}[paid_kind]
        method = "split" if method_kind.startswith("split") else method_kind
        details = None
        if method_kind == "split_ok":
            details = {"cash": round(paid / 2, 2), "mpesa": round(paid - round(paid / 2, 2), 2)}
        elif method_kind == "split_bad":
            details = {"cash": 1, "mpesa": 1}
        a = via_checkout(vat, discount, paid, method, details)
        b = via_window(vat, discount, paid, method, details)
        combos += 1
        same = a == b
        if not same and a[0] == b[0] == "sold":
            diff = {k: (a[1][k], b[1][k]) for k in a[1] if a[1][k] != b[1][k]}
        else:
            diff = (a, b)
        check(f"vat={vat} discount={discount} paid={paid_kind} method={method_kind}", same, diff)
check("ran the whole matrix", combos == 2 * 4 * 6 * 4, combos)

print("1b. Absolute figures, worked out by hand (parity alone passes a bug both paths share)")
# QA Widget sells at 100 (seed). Discount comes off first, then 16% VAT rounded UP to a whole
# shilling: 100-30 = 70, VAT 11.2 -> 12, total 82.
for vat, discount, want_sub, want_total in ((False, 0, 100.0, 100.0), (True, 0, 100.0, 116.0),
                                            (False, 30, 70.0, 70.0), (True, 30, 70.0, 82.0),
                                            (True, 250, 0.0, 0.0)):
    for path, sell in (("checkout", via_checkout), ("window", via_window)):
        kind, rows = sell(vat, discount, 0, "cash", None)
        check(f"{path} vat={vat} discount={discount}: subtotal {want_sub:g}, total {want_total:g}",
              kind == "sold" and (rows["subtotal"], rows["total"]) == (want_sub, want_total),
              (kind, rows if kind != "sold" else (rows["subtotal"], rows["total"])))
for path, sell in (("checkout", via_checkout), ("window", via_window)):
    kind, rows = sell(True, 0, 40, "cash", None)
    check(f"{path}: 40 paid on 116 leaves 76 owing, Partial, one 40 cash payment, a 76 credit",
          kind == "sold" and (rows["amountPayed"], rows["balance"], rows["payment_status"], rows["payments"],
                              [c[1] for c in rows["credits"]])
          == (40.0, 76.0, "Partial", [(40.0, "cash", "None", "order")], [76.0]),
          rows)
    kind, rows = sell(False, 0, 100, "mpesa", None)
    check(f"{path}: exact payment of 100 is Paid with nothing owing",
          kind == "sold" and (rows["amountPayed"], rows["balance"], rows["payment_status"]) == (100.0, 0.0, "Paid"),
          rows)
    check(f"{path}: a negative discount is refused (4xx)", sell(False, -5, 0, "cash", None) == ("refused", 4))

print("2. A quotation converted through a window keeps its discount and VAT")
with Session(engine) as db:
    inv = Invoice(customer_id=CUST, customer_name="QA Business", customer_type="registered",
                  created_by=CASHIER_ID, subtotal=300.0, discount=50.0, total=290.0, vat_enabled=True,
                  items=[{**ITEM, "quantity": 3}], invoice_number=f"Q-{uuid.uuid4().hex[:6]}")
    db.add(inv)
    db.commit()
    INV = inv.invoiceId
w = open_window()
r = client.put(f"/windows/{w['windowId']}/cart", json={
    "version": w["version"], "customerId": CUST, "VAT_status": True, "discount": 50, "sourceInvoiceId": INV,
    "items": [{**ITEM, "quantity": 3, "details": {**ITEM["details"], "quantity": 3}}]})
check("window keeps the quotation's discount", r.status_code == 200 and r.json()["discount"] == 50, r.text[:150])
ITEM3 = {**ITEM, "quantity": 3, "details": {**ITEM["details"], "quantity": 3}}
expected = via_checkout(True, 50, 0, "cash", None, items=[ITEM3])
r2 = client.post(f"/windows/{w['windowId']}/confirm", json={
    "version": r.json()["version"], "idempotencyKey": uuid.uuid4().hex, "amountPaid": 0})
got = order_rows(r2.json()["orderId"]) if r2.status_code == 200 else None
check("converted window charges what a checkout of the quotation charges",
      got is not None and got["total"] == expected[1]["total"] and got["discount"] == 50, (got, expected))
with Session(engine) as db:
    check("the quotation is marked converted", db.get(Invoice, INV).status == "converted")

print("3. A confirm can never charge twice")
w = open_window()
w = client.put(f"/windows/{w['windowId']}/cart", json={"version": w["version"], "customerId": CUST, "items": [ITEM]}).json()
key = uuid.uuid4().hex
results = []


def confirm():
    c = TestClient(main.app)
    results.append(c.post(f"/windows/{w['windowId']}/confirm", json={
        "version": w["version"], "idempotencyKey": key, "amountPaid": 50, "paymentMethod": "cash"}))


threads = [threading.Thread(target=confirm) for _ in range(4)]
for t in threads:
    t.start()
for t in threads:
    t.join()
oks = [r for r in results if r.status_code == 200]
check("four simultaneous confirms with one key all answer the same order", len(oks) == 4 and len({r.json()["orderId"] for r in oks}) == 1,
      [r.status_code for r in results])
if oks:
    with Session(engine) as db:
        n = len(db.exec(select(Payment).where(Payment.orderId == oks[0].json()["orderId"])).all())
    check("...and exactly one payment was recorded", n == 1, n)
r = client.post(f"/windows/{w['windowId']}/confirm", json={
    "version": w["version"], "idempotencyKey": uuid.uuid4().hex, "amountPaid": 50, "paymentMethod": "cash"})
check("a confirm with a different key is refused (410)", r.status_code == 410, r.status_code)

print("4. A released window can't be confirmed, and takes no money")
w = open_window()
w = client.put(f"/windows/{w['windowId']}/cart", json={"version": w["version"], "customerId": CUST, "items": [ITEM]}).json()
client.delete(f"/windows/{w['windowId']}")
r = client.post(f"/windows/{w['windowId']}/confirm", json={
    "version": w["version"], "idempotencyKey": uuid.uuid4().hex, "amountPaid": 50, "paymentMethod": "cash"})
check("confirm after release -> 410", r.status_code == 410, r.status_code)
with Session(engine) as db:
    n = len(db.exec(select(Payment).where(Payment.orderId == w["orderId"])).all())
check("no payment recorded against it", n == 0, n)

print()
print("ALL PASS" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
