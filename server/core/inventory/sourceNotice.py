"""The cutter's warning about where a source piece really is - worked out when an order is SHOWN.

A cut that consumes an offcut produced by an order whose cutting isn't done yet carries a
`pending_source_notice` (inventoryService._pending_source_notice, and the glass equivalent):
the piece may not exist on the rack yet. That notice is written once, when the cut is made, so
on its own it goes stale: the producing order gets cut (the piece now exists), its number
changes from "a sale window" to a receipt number, or the sale that opened the bar is released
and its cut is never made.

With provisional offcuts (PROVISIONAL_OFFCUTS_PLAN.md, R7) the stale case matters: a checkout
can cut from an open window's leftover, which exists only on paper - the window's bar is still
whole on the rack. So every order shown (the worksheet, the order screens, the cutting queue)
gets its notices brought up to date here. Never stored: a copy of the details is returned.

States, by what the producing sale is now:
  pending   confirmed, its cut not reported done - the piece may not be cut yet (as before)
  window    an open sale window - the bar is still whole: take the whole bar
  released  released or cancelled before its cut was made - the bar was never cut: take it whole
  (none)    its cut is reported done - the piece exists, the notice is dropped
"""
import copy
from typing import Optional

from sqlmodel import Session, select


def _bar_of(db: Session, src: dict) -> Optional[dict]:
    """The whole bar/sheet the consumed piece was cut from, if it came off one drawn from stock."""
    from core.inventory import offcutLedger as ledger
    from entities.offcutLedger import ORIGIN_STOCK_UNIT

    piece = ledger.get_piece(db, src.get("source_piece_id"))
    if piece is None:
        return None
    root = ledger.get_piece(db, piece.root_piece_id) if piece.root_piece_id else piece
    if root is None or root.origin != ORIGIN_STOCK_UNIT:
        return None
    if root.width:
        return {"width": root.width, "height": root.height}
    return {"length": root.length}


def _refresh(db: Session, src: dict, notice: dict) -> Optional[dict]:
    from core.ordering.visibility import ABANDONED, HELD
    from entities.orderItems import OrderItem
    from entities.orders import Order
    from entities.saleWindows import SaleWindow
    from entities.users import User

    item = db.get(OrderItem, notice.get("item_id")) if notice.get("item_id") else None
    order = db.get(Order, item.order_id if item is not None else notice.get("order_id")) \
        if (item is not None or notice.get("order_id")) else None
    if item is None or order is None:
        return notice  # nothing newer to say (an item replaced by an edit): leave it as written
    out = {**notice, "order_id": order.orderId, "order_no": order.order_no,
           "customer_name": order.customer_name or notice.get("customer_name")}
    if order.status == HELD:
        row = db.exec(select(SaleWindow, User).join(User, User.userId == SaleWindow.user_id)
                      .where(SaleWindow.order_id == order.orderId)).first()
        out.update(state="window", window=row[0].label if row else None, cashier=row[1].username if row else None,
                   bar=_bar_of(db, src))
        return out
    if item.cutting_completed:
        return None  # cut and reported done: the piece is real
    if order.status in (ABANDONED, "cancelled"):
        out.update(state="released", bar=_bar_of(db, src))
        return out
    out.update(state="pending")
    return out


def live_details(db: Optional[Session], details):
    """A copy of an order item's details with every source notice brought up to date."""
    if db is None or not isinstance(details, dict):
        return details
    lines = details.get("lineItems")
    if not isinstance(lines, list) or not any(
            isinstance(s, dict) and s.get("pending_source_notice")
            for l in lines if isinstance(l, dict) for s in (l.get("offcut_sources") or [])):
        return details
    out = copy.deepcopy(details)
    for line in out["lineItems"]:
        if not isinstance(line, dict):
            continue
        for src in line.get("offcut_sources") or []:
            if isinstance(src, dict) and src.get("pending_source_notice"):
                fresh = _refresh(db, src, src["pending_source_notice"])
                if fresh is None:
                    src.pop("pending_source_notice")
                else:
                    src["pending_source_notice"] = fresh
    return out
