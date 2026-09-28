from sqlmodel import SQLModel, Field
from sqlalchemy import Column, func
from sqlalchemy.dialects.postgresql import UUID as SA_UUID
from typing import Optional
from datetime import datetime
from uuid import UUID


class SaleWindow(SQLModel, table=True):
    """One open checkout at a till — a cart the cashier has parked while its customer pays,
    so they can serve someone else in another window.

    The cart itself lives in a real Order row with status "held" (order_id): its stock and
    offcuts are actually deducted, so every other window already sees the reduced figures
    without any availability query knowing windows exist. This row is only the session
    around it — who owns it, when it was last touched (for the 15-minute expiry), and an
    optimistic-concurrency version so two tabs on the same window can't overwrite each
    other's cart. See core/ordering/windowService.py.

    Rows are kept after a window closes (closed_at / close_reason), as the audit trail of
    who held what stock and for how long.
    """
    __tablename__ = "sale_windows"

    window_id: Optional[int] = Field(default=None, primary_key=True)
    order_id: int = Field(foreign_key="orders.orderId", nullable=False, unique=True)
    user_id: UUID = Field(sa_column=Column(SA_UUID(as_uuid=True), nullable=False, index=True))
    # Which till/browser opened it. Recorded for the audit trail only — ownership is by
    # user, so a cashier whose browser storage was cleared can still reach their windows.
    device_id: Optional[str] = Field(default=None, max_length=100)
    label: Optional[str] = Field(default=None, max_length=100)

    # Bumped on every cart change; a cart write or confirm carrying a stale version is
    # refused with 409 rather than silently overwriting a newer cart.
    version: int = Field(default=1, nullable=False)

    # Both are filled from the DATABASE clock (now()), never Python's: orders.created_at
    # and the expiry comparison both live in the DB session's local frame, and mixing in
    # datetime.utcnow() is exactly the bug the timezone fix of 2026-08-24 was about.
    opened_at: datetime = Field(sa_column_kwargs={"server_default": func.now()}, nullable=False)
    last_activity_at: datetime = Field(sa_column_kwargs={"server_default": func.now()}, nullable=False, index=True)

    closed_at: Optional[datetime] = Field(default=None, index=True)
    # "confirmed" | "released" (closed by its cashier) | "expired" (15 minutes idle)
    close_reason: Optional[str] = Field(default=None, max_length=20)

    # The client's idempotency key for the confirm that closed this window. A retried
    # confirm (double tap, flaky Tailscale link) with the same key gets the original
    # result back instead of an error — and can never create a second payment.
    confirm_key: Optional[str] = Field(default=None, max_length=100)


class OrderNumberCounter(SQLModel, table=True):
    """Single-row counter behind Order.order_no. Incremented with UPDATE ... RETURNING
    inside the confirming transaction, so a rollback un-takes the number — the reason
    order numbers stay gap-free where a SERIAL would not. See core/ordering/orderNumbers.py."""
    __tablename__ = "order_number_counter"

    id: int = Field(default=1, primary_key=True)
    last_no: int = Field(default=0, nullable=False)
