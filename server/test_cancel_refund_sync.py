"""One-off developer verification for the cancel-order refund/credit-sync fix.
Before this fix, cancelling an order restored stock but left amountPayed/
balance/Payment/Credit completely untouched — money collected stayed counted
as revenue with no refund trail, and any outstanding Credit kept showing on
the Dues page for an order that no longer exists. See _restore_and_cancel.

Run: python test_cancel_refund_sync.py  (requires a running dev DB)
"""
from sqlmodel import Session, create_engine, select
from db.database import DATABASE_URL
from core.ordering import orderService, model as order_model
from entities.users import User
from entities.customers import Customer
from entities.credits import Credit
from entities.payments import Payment
from entities.orders import Order
import uuid

import logging
logging.basicConfig(level=logging.WARNING)


def _check(label, cond):
    print(f"{'PASS' if cond else 'FAIL'}: {label}")
    return cond


def run():
    engine = create_engine(DATABASE_URL)
    all_ok = True

    with Session(engine) as db:
        user = db.exec(select(User).where(User.role.in_(["admin", "ceo", "manager", "cashier"]))).first()
        if not user:
            print("No user found in DB — cannot run test.")
            return

        customer = db.exec(select(Customer).where(Customer.type.in_(["individual", "cooperate"]))).first()
        if not customer:
            customer = Customer(name="Test Cancel Customer", phoneNumber=f"07{uuid.uuid4().int % 10**8:08d}", type="individual")
            db.add(customer)
            db.commit()
            db.refresh(customer)
        customer_id = customer.customerId

    # ── 1. Fully-paid order, cancelled — should refund and zero out ────────────
    with Session(engine) as db:
        payload = order_model.OrderCreate(
            customerId=customer_id, amountPaid=1000.0, servedBy=user.userId,
            paymentStatus="Paid",
            items=[order_model.OrderItemRequest(productId=15, quantity=1.0, unitPrice=1000.0, unitType="pcs", details={}, totalPrice=1000.0)],
            paymentMethod="mpesa",
        )
        order_id = orderService.create_order(payload, db, current_user=user).orderId
        print(f"Created fully-paid order {order_id}")

    with Session(engine) as db:
        order = db.get(Order, order_id)
        result = orderService._restore_and_cancel(db, order, user)
        db.commit()
        all_ok &= _check("refund result reports amount_refunded == 1000", abs(result["amount_refunded"] - 1000.0) < 0.02)
        all_ok &= _check("refund result reports refund_method == mpesa (last payment method)", result["refund_method"] == "mpesa")

    with Session(engine) as db:
        order = db.get(Order, order_id)
        payments = db.exec(select(Payment).where(Payment.orderId == order_id).order_by(Payment.paymentId)).all()
        all_ok &= _check("order.status == cancelled", order.status == "cancelled")
        all_ok &= _check("order.amountPayed reset to 0", abs(order.amountPayed) < 0.02)
        all_ok &= _check("order.balance == 0", abs(order.balance) < 0.02)
        all_ok &= _check("two payment rows exist (original + refund)", len(payments) == 2)
        all_ok &= _check("refund payment has reason=refund and negative amount", payments[-1].reason == "refund" and payments[-1].amount < 0)
        all_ok &= _check("original + refund net to zero", abs(sum(p.amount for p in payments)) < 0.02)

    # ── 2. Idempotency: cancelling an already-cancelled order refunds nothing again ──
    with Session(engine) as db:
        order = db.get(Order, order_id)
        result = orderService._restore_and_cancel(db, order, user)
        db.commit()
        all_ok &= _check("second cancel is a no-op (amount_refunded == 0)", result["amount_refunded"] == 0.0)

    with Session(engine) as db:
        payments = db.exec(select(Payment).where(Payment.orderId == order_id)).all()
        all_ok &= _check("still only two payment rows after double-cancel", len(payments) == 2)

    # ── 3. Unpaid credit order, cancelled — Credit row must close out ──────────
    with Session(engine) as db:
        payload = order_model.OrderCreate(
            customerId=customer_id, amountPaid=0.0, servedBy=user.userId,
            paymentStatus="Unpaid",
            items=[order_model.OrderItemRequest(productId=15, quantity=1.0, unitPrice=1000.0, unitType="pcs", details={}, totalPrice=1000.0)],
        )
        credit_order_id = orderService.create_order(payload, db, current_user=user).orderId
        print(f"Created unpaid credit order {credit_order_id}")

    with Session(engine) as db:
        credit = db.exec(select(Credit).where(Credit.orderId == credit_order_id)).first()
        all_ok &= _check("credit row created with status Pending", credit is not None and credit.status == "Pending")

    with Session(engine) as db:
        order = db.get(Order, credit_order_id)
        result = orderService._restore_and_cancel(db, order, user)
        db.commit()
        all_ok &= _check("no refund on a never-paid order", result["amount_refunded"] == 0.0)

    with Session(engine) as db:
        order = db.get(Order, credit_order_id)
        credit = db.exec(select(Credit).where(Credit.orderId == credit_order_id)).first()
        all_ok &= _check("order.balance voided to 0 on cancel", abs(order.balance) < 0.02)
        all_ok &= _check("credit.status closed to Paid so it drops off the Dues page", credit.status == "Paid")

    print("\nALL PASS" if all_ok else "\nSOME CHECKS FAILED")


if __name__ == "__main__":
    run()
