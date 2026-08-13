"""One-off developer verification for the payment/credit sync fix.
Run: python test_payment_credit_sync.py  (requires a running dev DB)
"""
from sqlmodel import Session, create_engine, select
from db.database import DATABASE_URL
from core.ordering import orderService, model as order_model
from core.financials import PaymentService
from entities.users import User
from entities.customers import Customer
from entities.credits import Credit
from entities.orders import Order
from fastapi import HTTPException
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
            customer = Customer(name="Test Dues Customer", phoneNumber=f"07{uuid.uuid4().int % 10**8:08d}", type="individual")
            db.add(customer)
            db.commit()
            db.refresh(customer)
        customer_id = customer.customerId

        # 1. Create an order with amountPaid=0, total=1000 (single item, unit price 1000)
        payload = order_model.OrderCreate(
            customerId=customer_id,
            amountPaid=0.0,
            servedBy=user.userId,
            paymentStatus="Unpaid",
            items=[
                order_model.OrderItemRequest(
                    productId=15,
                    quantity=1.0,
                    unitPrice=1000.0,
                    unitType="pcs",
                    details={},
                    totalPrice=1000.0,
                )
            ],
        )
        response = orderService.create_order(payload, db, current_user=user)
        order_id = response.orderId
        print(f"Created order {order_id}")

    with Session(engine) as db:
        order = db.get(Order, order_id)
        credit = db.exec(select(Credit).where(Credit.orderId == order_id)).first()
        all_ok &= _check("balance == total after 0-paid create", abs(order.balance - order.total) < 0.02)
        all_ok &= _check("credit exists with amount_due == balance", credit is not None and abs(credit.amount_due - order.balance) < 0.02)
        all_ok &= _check("credit status == Pending", credit.status == "Pending")
        total = order.total

    # 2. Partial payment
    with Session(engine) as db:
        result = PaymentService.record_payment(order_id, total * 0.4, "cash", db, user)
        all_ok &= _check("newPaymentStatus == Partial after partial payment", result.newPaymentStatus == "Partial")

    with Session(engine) as db:
        order = db.get(Order, order_id)
        credit = db.exec(select(Credit).where(Credit.orderId == order_id)).first()
        all_ok &= _check("order.balance matches credit.amount_due after partial payment", abs(order.balance - credit.amount_due) < 0.02)
        all_ok &= _check("credit.status == Partially Paid", credit.status == "Partially Paid")
        remaining = order.balance

    # 3. Pay off the rest
    with Session(engine) as db:
        result = PaymentService.record_payment(order_id, remaining, "mpesa", db, user)
        all_ok &= _check("newPaymentStatus == Paid after full payment", result.newPaymentStatus == "Paid")
        all_ok &= _check("newBalance == 0", abs(result.newBalance) < 0.02)

    with Session(engine) as db:
        order = db.get(Order, order_id)
        credit = db.exec(select(Credit).where(Credit.orderId == order_id)).first()
        all_ok &= _check("credit.status == Paid", credit.status == "Paid")
        all_ok &= _check("credit.settledAt is set", credit.settledAt is not None)

    # 4. Overpayment attempt should raise 400
    with Session(engine) as db:
        try:
            PaymentService.record_payment(order_id, 500.0, "cash", db, user)
            all_ok &= _check("overpayment on a paid order raises HTTPException", False)
        except HTTPException as e:
            all_ok &= _check("overpayment on a paid order raises HTTPException(400)", e.status_code == 400)

    # 5. Regression: update_order (edit, no new payment) must keep Credit in sync
    with Session(engine) as db:
        editor = db.exec(select(User).where(User.role.in_(["manager", "ceo", "admin"]))).first()
        if not editor:
            print("SKIP: no manager/ceo/admin user found for edit-path regression check")
            print("\nALL PASS" if all_ok else "\nSOME CHECKS FAILED")
            return
        payload = order_model.OrderCreate(
            customerId=customer_id,
            amountPaid=200.0,
            servedBy=editor.userId,
            paymentStatus="Partial",
            items=[
                order_model.OrderItemRequest(
                    productId=15, quantity=1.0, unitPrice=1000.0, unitType="pcs", details={}, totalPrice=1000.0,
                )
            ],
        )
        response = orderService.create_order(payload, db, current_user=editor)
        edit_order_id = response.orderId
        print(f"Created order {edit_order_id} for edit-sync regression check")

    with Session(engine) as db:
        edit_payload = order_model.OrderEditRequest(
            customerId=customer_id,
            amountPaid=0.0,  # no new payment during this edit
            servedBy=editor.userId,
            paymentStatus="Partial",
            items=[
                order_model.OrderItemRequest(
                    productId=15, quantity=2.0, unitPrice=1000.0, unitType="pcs", details={}, totalPrice=2000.0,
                )
            ],
            notes="regression test edit",
        )
        orderService.update_order(edit_order_id, edit_payload, db, current_user=editor)

    with Session(engine) as db:
        order = db.get(Order, edit_order_id)
        credit = db.exec(select(Credit).where(Credit.orderId == edit_order_id)).first()
        all_ok &= _check(
            "Credit.amount_due mirrors Order.balance after item-only edit (no new payment)",
            credit is not None and abs(credit.amount_due - order.balance) < 0.02,
        )

    print("\nALL PASS" if all_ok else "\nSOME CHECKS FAILED")


if __name__ == "__main__":
    run()
