"""Group-2 money fixes, end to end through the real services, on emiratesco_edit_test.
Run from server/:  .venv/bin/python <this file>
"""
import sys, os, uuid, logging
sys.path.insert(0, os.getcwd())
logging.disable(logging.CRITICAL)

from fastapi import HTTPException
from sqlmodel import Session, create_engine, select, text
from config import settings
import entities  # noqa: F401
from entities.users import User
from entities.customers import Customer
from entities.orders import Order
from entities.orderItems import OrderItem
from entities.payments import Payment
from entities.credits import Credit
from entities.products import Category, Product
from entities.variants import Variant
from entities.opJournal import StockOperation
from core.ordering import model, orderService
from core.financials import PaymentService
from core.financials.splitDetails import normalize_payment_details, signed_split_parts
from core.audit import undo as undo_engine

failures = []
def check(label, got, want):
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    if not ok:
        failures.append(label)

def raises(label, fn, status, contains=None):
    try:
        fn()
    except HTTPException as e:
        ok = e.status_code == status and (contains is None or (isinstance(e.detail, str) and contains in e.detail))
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {e.status_code} {e.detail!r}")
        if not ok:
            failures.append(label)
        if status == 409 or status == 400:
            # every refusal must carry a plain-string message (the UI renders it directly)
            if not isinstance(e.detail, str):
                failures.append(label + " (detail not a string)")
        return e
    print(f"  [FAIL] {label}: no exception, wanted {status}")
    failures.append(label)

class FakeUser:
    def __init__(self, uid, role="manager"):
        self.userId = uid; self.role = role; self.username = "qa"

base, _, _ = settings.get_database_url().rpartition("/")
engine = create_engine(f"{base}/emiratesco_edit_test", echo=False)

with Session(engine) as db:
    assert db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test"
    db.exec(text("TRUNCATE payments, credits, orderitems, edit_history, orders, invoices, variants, products, "
                 "categories, customers, stock_operations, stock_journal RESTART IDENTITY CASCADE"))
    db.commit()
    cat = Category(name="QA", type="hardware", sub_categories=[]); db.add(cat); db.flush()
    user = db.exec(select(User).where(User.role == "manager")).first()
    if user is None:
        user = User(userId=uuid.uuid4(), firstName="QA", secondName="Mgr", phoneNumber="0700000009",
                    role="manager", email="qa_m2@qa-emiratesco.com", username="qa_m2", password="x",
                    mustChangePassword=False, isActive=True)
        db.add(user); db.flush()
    p = Product(name="QA Widget", category_id=cat.categoryId, stock_quantity=1000, has_variants=True, unit="pcs", sub_category="general")
    db.add(p); db.flush()
    v = Variant(product_id=p.productId, name="", attributes={}, stock_quantity=1000, price=100.0)
    db.add(v); db.flush()
    cust = Customer(name="QA Customer", phoneNumber="0711111112", type="individual"); db.add(cust)
    db.commit()
    IDS = dict(user=user.userId, product=p.productId, variant=v.variantId, customer=cust.customerId)
USER = FakeUser(IDS["user"])

def item(qty=1, price=100.0):
    return model.OrderItemRequest(productId=IDS["product"], variantId=IDS["variant"], quantity=qty,
                                  unitPrice=price, unitType="pcs", details={}, totalPrice=qty * price)

def create(paid, qty=1, method="cash", details=None, discount=0.0, vat=False, customer=True):
    with Session(engine) as db:
        r = orderService.create_order(model.OrderCreate(
            customerId=IDS["customer"] if customer else None, customerName=None if customer else "Walk-in",
            amountPaid=paid, servedBy=IDS["user"], VAT_status=vat, discount=discount,
            paymentMethod=method, paymentDetails=details, items=[item(qty)]), db, current_user=USER)
        return r.orderId

def edit(order_id, qty, paid, method="cash", details=None, discount=0.0):
    with Session(engine) as db:
        return orderService.update_order(order_id, model.OrderEditRequest(
            customerId=IDS["customer"], amountPaid=paid, servedBy=IDS["user"], VAT_status=False,
            discount=discount, paymentMethod=method, paymentDetails=details, items=[item(qty)]), db, USER)

def state(order_id):
    with Session(engine) as db:
        o = db.get(Order, order_id)
        pays = db.exec(select(Payment).where(Payment.orderId == order_id).order_by(Payment.paymentId)).all()
        items = db.exec(select(OrderItem).where(OrderItem.order_id == order_id)).all()
        stock = db.get(Variant, IDS["variant"]).stock_quantity
        return o, pays, items, stock

def stock_now():
    with Session(engine) as db:
        return db.get(Variant, IDS["variant"]).stock_quantity

def order_count():
    with Session(engine) as db:
        return len(db.exec(select(Order)).all())

# ── 1. split helper ───────────────────────────────────────────────────────────
print("1. normalize_payment_details / signed_split_parts")
check("non-split carries no details", normalize_payment_details("cash", {"cash": 5}, 100), None)
check("split payment kept positive", normalize_payment_details("split", {"cash": 40, "mpesa": 60}, 100), {"cash": 40.0, "mpesa": 60.0})
check("refund magnitudes are signed", normalize_payment_details("split", {"cash": 40, "mpesa": 60}, -100), {"cash": -40.0, "mpesa": -60.0})
check("already-signed refund kept", normalize_payment_details("split", {"cash": -40, "mpesa": -60}, -100), {"cash": -40.0, "mpesa": -60.0})
check("zero part has no -0.0", normalize_payment_details("split", {"cash": 0, "mpesa": 100}, -100), {"cash": 0.0, "mpesa": -100.0})
check("ceil rounding within a shilling accepted", normalize_payment_details("split", {"cash": 40.5, "mpesa": 60}, 100) is not None, True)
raises("negative cash on a payment refused", lambda: normalize_payment_details("split", {"cash": -500, "mpesa": 600}, 100), 400)
raises("parts not adding up refused", lambda: normalize_payment_details("split", {"cash": 10, "mpesa": 10}, 100), 400)
raises("unknown part refused", lambda: normalize_payment_details("split", {"cash": 50, "card": 50}, 100), 400)
raises("missing details refused", lambda: normalize_payment_details("split", None, 100), 400)
raises("non-number refused", lambda: normalize_payment_details("split", {"cash": "abc", "mpesa": 100}, 100), 400)
check("legacy positive refund read as negative", signed_split_parts({"cash": 0, "mpesa": 3800}, -3800), {"cash": -0.0, "mpesa": -3800.0})
check("correct refund read unchanged", signed_split_parts({"cash": -400, "mpesa": -600}, -1000), {"cash": -400.0, "mpesa": -600.0})
check("garbage details read as empty", signed_split_parts("nope", 100), {})

# ── 2. create_order bounds ────────────────────────────────────────────────────
print("2. New sale: amount checks")
s0, n0 = stock_now(), order_count()
raises("negative amount refused", lambda: create(-500), 400, "negative")
raises("overpay refused with server total", lambda: create(50000), 400, "KSH 100")
raises("negative discount refused", lambda: create(0, discount=-50), 400, "discount")
raises("split not adding up refused", lambda: create(100, method="split", details={"cash": 10, "mpesa": 10}), 400)
check("refusals leave stock untouched", stock_now(), s0)
check("refusals leave no order behind", order_count(), n0)
oid = create(100.4)  # ceil -> 101, within the 1-shilling tolerance; recorded as the 100 owed
o, pays, _, _ = state(oid)
check("tolerance overpay capped to total", (o.amountPayed, o.balance, o.payment_status), (100.0, 0.0, "Paid"))
check("payment row equals amountPayed", [p_.amount for p_ in pays], [100.0])
oid = create(100, method="split", details={"cash": 30, "mpesa": 70})
_, pays, _, _ = state(oid)
check("split sale details stored", pays[0].payment_details, {"cash": 30.0, "mpesa": 70.0})
oid = create(100, method="cash", details={"cash": 999})
_, pays, _, _ = state(oid)
check("non-split method drops stray details", pays[0].payment_details, None)
oid = create(40)
o, pays, _, _ = state(oid)
check("partial sale", (o.amountPayed, o.balance, o.payment_status), (40.0, 60.0, "Partial"))

# ── 3. edit money ─────────────────────────────────────────────────────────────
print("3. Edit: money moves exactly once and only on current figures")
oid = create(100)                      # paid in full, total 100
edit(oid, 2, 100)                      # total 200, collect the extra 100
o, pays, _, _ = state(oid)
check("edit collecting more", (o.amountPayed, o.balance, [p_.amount for p_ in pays]), (200.0, 0.0, [100.0, 100.0]))
edit(oid, 1, -100, method="split", details={"cash": 40, "mpesa": 60})  # back to 100, refund 100 as magnitudes
o, pays, _, _ = state(oid)
check("edit refund recorded once", (o.amountPayed, o.balance, pays[-1].amount, pays[-1].reason), (100.0, 0.0, -100.0, "refund"))
check("edit split refund stored negative", pays[-1].payment_details, {"cash": -40.0, "mpesa": -60.0})

oid = create(40)                       # 40 of 100
with Session(engine) as db:            # another till collects the rest meanwhile
    PaymentService.record_payment(oid, 60, "cash", db, USER)
s0 = stock_now()
o0, pays0, items0, _ = state(oid)
# the stale screen still thinks 40 was paid: new total 200 -> asks for 160
raises("stale edit refused", lambda: edit(oid, 2, 160), 409, "Reopen")
o1, pays1, items1, _ = state(oid)
check("stale edit moved no stock", stock_now(), s0)
check("stale edit left the order alone", (o1.total, o1.amountPayed, len(pays1), [i.item_id for i in items1]),
      (o0.total, o0.amountPayed, len(pays0), [i.item_id for i in items0]))
edit(oid, 2, 100)                      # with the current figures it goes through
o, _, _, _ = state(oid)
check("current edit accepted", (o.total, o.amountPayed, o.balance), (200.0, 200.0, 0.0))

oid = create(200, qty=2)               # paid 200
raises("refund larger than overpaid refused", lambda: edit(oid, 1, -150), 400, "more than the customer overpaid")
raises("negative 'payment' with nothing to refund refused", lambda: edit(create(40), 1, -20), 400)
raises("negative discount on edit refused", lambda: edit(oid, 2, 0, discount=-10), 400, "discount")
raises("split edit not adding up refused", lambda: edit(oid, 3, 100, method="split", details={"cash": 1, "mpesa": 1}), 400)

print("   discount survives an edit when sent")
oid = create(450, qty=5, discount=50)  # 500 - 50
edit(oid, 6, 100, discount=50)         # 600 - 50 = 550, collect 100
o, _, _, _ = state(oid)
check("discount kept, delta is only the new item", (o.discount, o.total, o.amountPayed, o.balance), (50.0, 550.0, 550.0, 0.0))

print("   undo tool re-run (money_check=False) keeps its old behaviour")
oid = create(200, qty=2)
with Session(engine) as db:
    req = model.OrderEditRequest(customerId=IDS["customer"], amountPaid=0, servedBy=IDS["user"],
                                 VAT_status=False, items=[item(1)])
    orderService.apply_order_edit(oid, req, db, USER, money_check=False)
    db.commit()
o, pays, _, _ = state(oid)
check("re-run records no payment row", len(pays), 1)

# ── 4. cancel ─────────────────────────────────────────────────────────────────
print("4. Cancel: refund matches what the cashier saw; split signed")
from core.settings.service import set_cancel_pin
with Session(engine) as db:
    set_cancel_pin(db, "4321", FakeUser(IDS["user"], role="ceo"))
    db.commit()

def cancel(order_id, **kw):
    with Session(engine) as db:
        return orderService.cancel_order_with_pin(order_id, "4321", db, USER, **kw)

oid = create(40)
with Session(engine) as db:
    PaymentService.record_payment(oid, 30, "cash", db, USER)   # paid is now 70
raises("stale refund refused", lambda: cancel(oid, refund_method="cash", expected_refund=40), 409, "KSH 70")
o, _, _, _ = state(oid)
check("order still active after refusal", o.status != "cancelled", True)
raises("split refund not adding up refused", lambda: cancel(oid, refund_method="split", refund_details={"cash": 1, "mpesa": 1}, expected_refund=70), 400)
o, _, _, s_after = state(oid)
check("order still active after bad split", o.status != "cancelled", True)
cancel(oid, refund_method="split", refund_details={"cash": 20, "mpesa": 50}, expected_refund=70)
o, pays, _, _ = state(oid)
check("cancelled", (o.status, o.amountPayed, o.balance), ("cancelled", 0.0, 0.0))
check("refund row", (pays[-1].amount, pays[-1].reason), (-70.0, "refund"))
check("split refund stored negative", pays[-1].payment_details, {"cash": -20.0, "mpesa": -50.0})
oid = create(100)
cancel(oid, refund_method="cash")       # older client: no expectedRefund
o, _, _, _ = state(oid)
check("cancel without expectedRefund still works", o.status, "cancelled")

# ── 5. financial summary ──────────────────────────────────────────────────────
print("5. CEO summary buckets")
with Session(engine) as db:
    db.exec(text("TRUNCATE payments RESTART IDENTITY CASCADE")); db.commit()
    any_order = db.exec(select(Order)).first().orderId
    db.add(Payment(orderId=any_order, amount=1000, payment_method="split", reason="order", payment_details={"cash": 400, "mpesa": 600}))
    db.add(Payment(orderId=any_order, amount=-1000, payment_method="split", reason="refund", payment_details={"cash": 300, "mpesa": 700}))  # legacy shape
    db.add(Payment(orderId=any_order, amount=500, payment_method="cash", reason="order"))
    db.add(Payment(orderId=any_order, amount=-200, payment_method="split", reason="refund", payment_details={"cash": -50, "mpesa": -150}))
    db.commit()
    summ = PaymentService.get_financial_summary("day", None, db)
    total, cash, mpesa = summ.total, summ.by_method["cash"], summ.by_method["mpesa"]
    check("total", total, 300.0)
    check("cash bucket (400 - 300 + 500 - 50)", cash, 550.0)
    check("mpesa bucket (600 - 700 - 150)", mpesa, -250.0)
    check("buckets add up to total", round(cash + mpesa, 2), 300.0)

# ── 6. collect debt ───────────────────────────────────────────────────────────
print("6. Collect debt (record_payment)")
oid = create(0)
with Session(engine) as db:
    raises("negative split cash refused", lambda: PaymentService.record_payment(oid, 50, "split", db, USER, {"cash": -10, "mpesa": 60}), 400)
with Session(engine) as db:
    PaymentService.record_payment(oid, 50, "split", db, USER, {"cash": 20, "mpesa": 30})
o, pays, _, _ = state(oid)
check("debt split stored", (pays[-1].amount, pays[-1].payment_details), (50.0, {"cash": 20.0, "mpesa": 30.0}))
check("order updated", (o.amountPayed, o.balance, o.payment_status), (50.0, 50.0, "Partial"))

# ── 7. undo keeps a split's breakdown ─────────────────────────────────────────
print("7. Undo an edit's split refund, money NOT handed back")
oid = create(200, qty=2)
edit(oid, 1, -100, method="split", details={"cash": 30, "mpesa": 70})
with Session(engine) as db:
    op = db.exec(select(StockOperation).where(StockOperation.order_id == oid).order_by(StockOperation.created_at.desc())).first()
    undo_engine.undo_operation(db, op.op_id, actor=USER, reason="qa", money_handled=False)
    db.commit()
o, pays, _, _ = state(oid)
comp = pays[-1]
check("compensating row reverses the refund", (comp.amount, comp.payment_method), (100.0, "split"))
check("compensating row keeps the breakdown, reversed", comp.payment_details, {"cash": 30.0, "mpesa": 70.0})
check("order back to paid 200", (o.total, o.amountPayed, o.balance), (200.0, 200.0, 0.0))

print()
print("ALL PASS" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
