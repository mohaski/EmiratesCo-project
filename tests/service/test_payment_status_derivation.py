"""Checks that create_order derives payment_status from server-side totals and
ignores whatever the client sends. Runs against emiratesco_edit_test only.
Run from server/:  .venv/bin/python <this file>
"""
import sys, os, uuid, logging
sys.path.insert(0, os.getcwd())
logging.disable(logging.CRITICAL)

from sqlmodel import Session, create_engine, select, text
from config import settings
import entities  # noqa: F401
from entities.users import User
from entities.customers import Customer
from entities.credits import Credit
from entities.orders import Order
from entities.payments import Payment
from entities.products import Category, Product
from entities.variants import Variant
from core.ordering import model, orderService

failures = []
def check(label, got, want):
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    if not ok:
        failures.append(label)

class FakeUser:
    def __init__(self, uid):
        self.userId = uid; self.role = "cashier"; self.username = "qa"

base, _, _ = settings.get_database_url().rpartition("/")
engine = create_engine(f"{base}/emiratesco_edit_test", echo=False)

with Session(engine) as db:
    assert db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test"
    db.exec(text("TRUNCATE payments, credits, orderitems, edit_history, orders, variants, products, categories, customers RESTART IDENTITY CASCADE"))
    db.commit()
    cat = Category(name="QA", type="accessories", sub_categories=[]); db.add(cat); db.flush()
    user = db.exec(select(User)).first()
    if user is None:
        user = User(userId=uuid.uuid4(), firstName="QA", secondName="User", phoneNumber="0700000001",
                    role="cashier", email="qa@qa-emiratesco.com", username="qa", password="x",
                    mustChangePassword=False, isActive=True)
        db.add(user); db.flush()
    p = Product(name="QA Widget", category_id=cat.categoryId, stock_quantity=1000, has_variants=True, unit="pcs")
    db.add(p); db.flush()
    v = Variant(product_id=p.productId, name="", attributes={}, stock_quantity=1000, price=100.0)
    db.add(v); db.flush()
    cust = Customer(name="QA Customer", phoneNumber="0711111111", type="individual"); db.add(cust)
    db.commit()
    IDS = dict(user=user.userId, product=p.productId, variant=v.variantId, customer=cust.customerId)

def make(label, *, qty=1, unit_price=100.0, paid=0.0, status="__omit__", customer=True, vat=False, discount=0.0):
    kw = dict(customerId=IDS["customer"] if customer else None, customerName=None if customer else "Walk-in",
              amountPaid=paid, servedBy=IDS["user"], VAT_status=vat, discount=discount,
              paymentMethod="cash",
              items=[model.OrderItemRequest(productId=IDS["product"], variantId=IDS["variant"], quantity=qty,
                                            unitPrice=unit_price, unitType="pcs", details={}, totalPrice=qty * unit_price)])
    if status != "__omit__":
        kw["paymentStatus"] = status
    with Session(engine) as db:
        res = orderService.create_order(model.OrderCreate(**kw), db, current_user=FakeUser(IDS["user"]))
    with Session(engine) as db:
        o = db.get(Order, res.orderId)
        credit = db.exec(select(Credit).where(Credit.orderId == o.orderId)).first()
        pays = db.exec(select(Payment).where(Payment.orderId == o.orderId)).all()
        print(f"{label}: total={o.total} paid={o.amountPayed} balance={o.balance} status={o.payment_status}")
        return o, credit, pays

print("1. Client lies 'Paid' with nothing paid (registered)")
o, credit, pays = make("1", paid=0, status="Paid")
check("status", o.payment_status, "Unpaid"); check("credit created", credit is not None, True); check("no payment row", len(pays), 0)

print("2. Client says 'Unpaid' but pays in full")
o, credit, pays = make("2", paid=100, status="Unpaid")
check("status", o.payment_status, "Paid"); check("no credit", credit, None); check("one payment row", len(pays), 1)

print("3. Client says 'Paid', pays 40")
o, credit, pays = make("3", paid=40, status="Paid")
check("status", o.payment_status, "Partial"); check("credit due", credit and credit.amount_due, 60.0)

print("4. paymentStatus omitted entirely (new clients may drop it)")
o, *_ = make("4", paid=100)
check("status", o.payment_status, "Paid")

print("5. Server reprices: client priced at 50 and paid 50, variant price is 100")
o, credit, _ = make("5", unit_price=50.0, paid=50, status="Paid")
check("server total", o.total, 100.0); check("status", o.payment_status, "Partial"); check("credit due", credit and credit.amount_due, 50.0)

print("6. Walk-in, client says 'Paid' but repricing leaves a balance")
o, credit, _ = make("6", unit_price=50.0, paid=50, status="Paid", customer=False)
check("status", o.payment_status, "Partial")

print("7. VAT order paid in full (total includes 16% VAT)")
o, *_ = make("7", paid=116, status="Paid", vat=True)
check("total", o.total, 116.0); check("status", o.payment_status, "Paid")

print("8. Full discount -> total 0, nothing paid")
o, *_ = make("8", paid=0, status="Unpaid", discount=100.0)
check("total", o.total, 0.0); check("status", o.payment_status, "Paid")

print("9. Balance within the 0.10 tolerance counts as Paid")
o, *_ = make("9", qty=1, unit_price=100.0, paid=99.95, status="Partial")
check("status", o.payment_status, "Paid")

print("10. Order response still carries paymentStatus")
with Session(engine) as db:
    resp = orderService.get_order_by_orderId(o.orderId, db)
    check("response paymentStatus", resp.paymentStatus, "Paid")

print()
print("ALL PASS" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
