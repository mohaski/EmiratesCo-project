"""An order's items round-trip: what create_order stores is what get_order_by_orderId returns,
and the sale moves stock and money as it should. Uses fixture product 15 (no variant; see
tests/fixture_product15.py). Test database only. Exits 1 on any failure."""
import logging
import sys

from sqlmodel import Session, create_engine, select

from _testdb_guard import require_test_db
from db.database import DATABASE_URL
from core.ordering import orderService, model
from entities.payments import Payment
from entities.products import Product
from entities.users import User

logging.basicConfig(level=logging.WARNING)
failures = []


def check(label, got, want):
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f" — got {got!r}, want {want!r}"))
    if not ok:
        failures.append(label)


def test_persistence():
    engine = create_engine(DATABASE_URL)
    require_test_db(engine)
    with Session(engine) as db:
        user = db.exec(select(User)).first()
        product = db.get(Product, 15)
        if user is None or product is None:
            check("fixture present (a user and product 15)", (user is not None, product is not None), (True, True))
            return
        stock_before = product.stock_quantity
        payload = model.OrderCreate(
            customerId=None, amountPaid=1500.0, servedBy=user.userId, paymentStatus="Paid",
            items=[model.OrderItemRequest(productId=15, quantity=3.0, unitPrice=500.0, unitType="pcs",
                                          details={"existing": "meta"}, totalPrice=1500.0)],
        )
        order_id = orderService.create_order(payload, db, current_user=user).orderId

    with Session(engine) as db:
        fetched = orderService.get_order_by_orderId(order_id, db)
        check("one item stored", len(fetched.items), 1)
        item = fetched.items[0]
        check("quantity round-trips", item.quantity, 3.0)
        check("the item's own details are kept", (item.details or {}).get("existing"), "meta")
        check("order total", float(fetched.total), 1500.0)
        check("fully paid", (float(fetched.amountPaid), float(fetched.balance)), (1500.0, 0.0))
        check("stock moved by the quantity sold", db.get(Product, 15).stock_quantity, stock_before - 3)
        payments = db.exec(select(Payment).where(Payment.orderId == order_id)).all()
        check("one payment row for the amount paid", [float(p.amount) for p in payments], [1500.0])


if __name__ == "__main__":
    try:
        test_persistence()
    except Exception as e:  # an error is a failure, never a quiet exit 0
        import traceback
        traceback.print_exc()
        failures.append(f"crashed: {type(e).__name__}: {e}")
    print("\nALL PASS" if not failures else f"\n{len(failures)} FAILED: {failures}")
    sys.exit(1 if failures else 0)
