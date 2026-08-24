from fastapi import HTTPException, Depends
from entities.payments import Payment
from entities.credits import Credit
from db.database import get_session
from entities.orders import Order
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlmodel import Session, select
from loggiing import logger
from sqlalchemy import func
from datetime import datetime, timedelta
from utils import require_role, ceil_amount

from . import model

def calculate_cash_payments_for_today(db: Session = Depends(get_session)) -> float:
    """
    Calculate the total cash payments received today.
    - Queries the payments made today with payment method 'Cash'.
    - Returns the total amount of cash payments.
    """
    try:
        # 🕒 Filter all 'Cash' payments made today
        statement = (
            select(Payment.amount)
            .where(
                Payment.payment_method == "cash",
                func.date(Payment.payed_at) == func.current_date()  # ensures date-only comparison
            )
        )

        # 🎯 Execute the query
        results = db.exec(statement).all()

        # 🧮 Compute total
        total_cash = sum(results) if results else 0.0

        logger.info(f"Total cash payments for today: {total_cash}")
        return total_cash

    except Exception as e:
        logger.error(f"Error calculating cash payments: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to calculate cash payments")
    
def calculate_cash_payments_for_certain_date(date: str, db: Session = Depends(get_session)) -> float:
    """
    Calculate the total cash payments received on a specific date.
    
    Parameters:
    - date (str): Date string in 'YYYY-MM-DD' format.
    - db (Session): Database session dependency.

    Returns:
    - float: Total amount of cash payments received on that date.
    """

    try:
        # ✅ Step 1: Validate date format
        try:
            parsed_date = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use 'YYYY-MM-DD'")

        # ✅ Step 2: Query 'Cash' payments for the given date
        statement = (
            select(func.coalesce(func.sum(Payment.amount), 0))
            .where(
                Payment.payment_method == "cash",
                func.date(Payment.payed_at) == parsed_date
            )
        )

        # ✅ Step 3: Execute and extract result
        total_cash = db.exec(statement).one_or_none() or (0,)

        total_cash_amount = float(total_cash[0])  # extract from tuple

        logger.info(f"✅ Total cash payments for {parsed_date}: {total_cash_amount}")
        return total_cash_amount

    except HTTPException:
        raise  # re-raise known exceptions to keep HTTP status
    except SQLAlchemyError as e:
        logger.error(f"Database error calculating cash payments for {date}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database query failed")
    except Exception as e:
        logger.error(f"Unexpected error calculating cash payments for {date}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to calculate cash payments for the specified date")


def get_financial_summary(period: str, date_str: str | None, db: Session) -> model.FinancialSummaryResponse:
    """
    Money received (every Payment row regardless of reason — checkout-time
    payments from create_order/update_order and later debt-collection
    payments from record_payment both count) in the given period, broken down
    into just 'cash' and 'mpesa' — the only two methods used in practice. A
    'split' row's true breakdown lives in its payment_details JSON (e.g.
    {"cash": 100, "mpesa": 200}) rather than the row's own amount, so those
    are decomposed into the same two buckets; the legacy/unused 'number'
    method and any other unrecognized method or malformed payment_details
    fall back into 'cash' rather than being silently dropped — total always
    equals by_method['cash'] + by_method['mpesa'].
    """
    if period not in {"day", "month", "year"}:
        raise HTTPException(status_code=400, detail="period must be 'day', 'month', or 'year'")

    try:
        if date_str:
            anchor = datetime.strptime(date_str, "%Y-%m-%d").date()
        else:
            # "Today" must be anchored to the DB's local date, not the app
            # server's UTC clock — Payment.payed_at is a naive timestamp
            # stored in the DB session's local timezone (e.g. Africa/Nairobi,
            # UTC+3). Anchoring on datetime.utcnow().date() instead drifts by
            # that offset, so any payment recorded in the first few hours
            # after local midnight got excluded from "today"'s totals until
            # the app server's UTC clock caught up.
            anchor = db.exec(select(func.current_date())).one()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use 'YYYY-MM-DD'")

    if period == "day":
        range_start = range_end = anchor
    elif period == "month":
        range_start = anchor.replace(day=1)
        next_month = range_start.replace(day=28) + timedelta(days=4)
        range_end = next_month.replace(day=1) - timedelta(days=1)
    else:
        range_start = anchor.replace(month=1, day=1)
        range_end = anchor.replace(month=12, day=31)

    payments = db.exec(
        select(Payment).where(
            func.date(Payment.payed_at) >= range_start,
            func.date(Payment.payed_at) <= range_end,
        )
    ).all()

    by_method = {"cash": 0.0, "mpesa": 0.0}
    # A payment "counts" toward whichever bucket(s) it actually put money into —
    # a split touching both cash and mpesa counts once in each, not as a third thing.
    by_method_count = {"cash": 0, "mpesa": 0}
    total = 0.0
    for p in payments:
        total += p.amount
        if p.payment_method == "split":
            details = p.payment_details or {}
            matched = sum(float(v or 0) for k, v in details.items() if k in by_method)
            leftover = p.amount - matched
            touched = set()
            for k, v in details.items():
                if k in by_method and float(v or 0) != 0:
                    by_method[k] += float(v or 0)
                    touched.add(k)
            if leftover:
                by_method["cash"] += leftover
                touched.add("cash")
            for k in touched:
                by_method_count[k] += 1
        elif p.payment_method in by_method:
            by_method[p.payment_method] += p.amount
            by_method_count[p.payment_method] += 1
        else:
            by_method["cash"] += p.amount
            by_method_count["cash"] += 1

    orders = db.exec(
        select(Order).where(
            func.date(Order.created_at) >= range_start,
            func.date(Order.created_at) <= range_end,
        )
    ).all()
    status_counts: dict = {}
    for o in orders:
        status_counts[o.status] = status_counts.get(o.status, 0) + 1

    return model.FinancialSummaryResponse(
        period=period,
        range_start=range_start.isoformat(),
        range_end=range_end.isoformat(),
        total=total,
        by_method=by_method,
        by_method_count=by_method_count,
        order_count=len(orders),
        status_counts=status_counts,
    )


def get_payments_for_order(order_id: int, db: Session) -> list[model.PaymentRecord]:
    """Full payment history for one order (every reason — order/debt/refund),
    oldest first — feeds the Dues Follow-Up debt-detail view."""
    from entities.users import User

    rows = db.exec(
        select(Payment, User)
        .join(User, Payment.recorded_by == User.userId, isouter=True)
        .where(Payment.orderId == order_id)
        .order_by(Payment.payed_at.asc())
    ).all()

    return [
        model.PaymentRecord(
            paymentId=p.paymentId,
            amount=p.amount,
            method=p.payment_method,
            reason=p.reason,
            paymentDetails=p.payment_details,
            payedAt=p.payed_at.isoformat() if p.payed_at else "",
            recordedByName=u.username if u else None,
        )
        for p, u in rows
    ]


def _sync_credit_for_order(db: Session, order: Order) -> None:
    """Keep the order's Credit row (if any) mirroring Order.balance/amountPayed.
    This is the single place that reconciles the two, called both by
    record_payment and by order-edit so they can never drift apart."""
    credit = db.exec(select(Credit).where(Credit.orderId == order.orderId)).first()

    if credit:
        credit.amount_due = order.balance
        if order.balance <= 0.10:
            credit.status = "Paid"
            if not credit.settledAt:
                credit.settledAt = datetime.utcnow()
        else:
            credit.status = "Partially Paid" if order.amountPayed > 0 else "Pending"
        db.add(credit)
    elif order.balance > 0.01 and order.customerid:
        # Order didn't have a credit row yet (e.g. was created fully paid, then
        # edited to owe money) — create one now, matching create_order's rule.
        new_credit = Credit(
            orderId=order.orderId,
            customerId=order.customerid,
            amount=order.total,
            amount_due=order.balance,
            status="Partially Paid" if order.amountPayed > 0 else "Pending",
        )
        db.add(new_credit)


def record_payment(
    order_id: int,
    amount: float,
    payment_method: str,
    db: Session,
    current_user,
    payment_details: dict | None = None,
) -> model.RecordPaymentResponse:
    """
    Single transactional entry point for "money was collected against this
    order" AFTER checkout — this is the Collect Payments / Dues page path,
    never the initial order-creation payment (that's recorded inline by
    orderService.create_order/update_order instead), so every Payment row
    created here is tagged reason='debt'. Creates the Payment row, recomputes
    Order.amountPayed/balance/payment_status, and syncs the associated Credit
    row — all in one commit.
    """
    require_role(["cashier", "manager", "ceo", "admin"], current_user)

    try:
        if amount is None or amount <= 0:
            raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")

        order = db.exec(select(Order).where(Order.orderId == order_id)).first()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if order.status == "cancelled":
            raise HTTPException(status_code=400, detail="Cannot record a payment against a cancelled order")

        if amount > (order.balance or 0) + 0.10:
            raise HTTPException(status_code=400, detail="Payment exceeds the outstanding balance")

        # Ceil to a whole currency unit, but never past what's actually owed
        # (rounding up a near-full payment must not manufacture a negative balance).
        amount = min(float(ceil_amount(amount)), order.balance or amount)

        pay_method = (payment_method or "cash").lower()
        if pay_method not in {"cash", "mpesa", "split", "number"}:
            pay_method = "cash"

        new_payment = Payment(
            orderId=order_id,
            amount=amount,
            payment_method=pay_method,
            reason="debt",
            payment_details=payment_details,
            recorded_by=current_user.userId,
        )
        db.add(new_payment)

        new_paid = (order.amountPayed or 0) + amount
        new_balance = max((order.total or 0) - new_paid, 0.0)
        order.amountPayed = new_paid
        order.balance = new_balance
        order.payment_status = "Paid" if new_balance <= 0.10 else "Partial"
        db.add(order)

        _sync_credit_for_order(db, order)

        db.commit()
        db.refresh(new_payment)
        db.refresh(order)

        logger.info(f"Payment recorded for order {order_id}: amount={amount}, new_balance={new_balance}")

        return model.RecordPaymentResponse(
            message="Payment recorded successfully",
            paymentId=new_payment.paymentId,
            orderId=order_id,
            newBalance=new_balance,
            newPaymentStatus=order.payment_status,
        )

    except HTTPException:
        raise
    except IntegrityError as e:
        db.rollback()
        logger.error(f"Database integrity error while recording payment: {e}")
        raise HTTPException(status_code=400, detail="Invalid payment data")
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error while recording payment: {e}")
        raise HTTPException(status_code=500, detail="Failed to record payment")

