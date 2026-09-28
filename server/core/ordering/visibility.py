"""Which orders are real sales.

An open sale window is stored as an Order with status "held" so that its stock is genuinely
deducted (see core/ordering/windowService.py). A window closed without confirming becomes
"abandoned". Neither is a sale: they must never show up in order history, the CEO's figures,
the cutting queue (no cutting before payment), debts, or anywhere an order can be edited,
cancelled or paid against.

Every order query outside the window service filters through here, so a new listing only
has to remember one thing.
"""
from fastapi import HTTPException

from entities.orders import Order

HELD = "held"
ABANDONED = "abandoned"
HIDDEN_STATUSES = (HELD, ABANDONED)


def visible_orders():
    """WHERE clause: only real orders (not open or abandoned sale windows)."""
    return Order.status.notin_(HIDDEN_STATUSES)


def is_hidden(order) -> bool:
    return order is not None and order.status in HIDDEN_STATUSES


def get_visible_order_or_404(db, order_id: int) -> Order:
    """db.get for an order the caller is allowed to see as an order. A held/abandoned
    window reads as "not found" — it has no order number and is not a sale."""
    order = db.get(Order, order_id)
    if order is None or is_hidden(order):
        raise HTTPException(status_code=404, detail="Order not found")
    return order
