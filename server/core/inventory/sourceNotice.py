"""What the cutter is told about a cut's source - worked out when an order is SHOWN, never stored.

Two things are brought up to date for every order shown (the worksheet, the order screens, the
cutting queue), on a copy of its details:

1. The PHYSICAL source of a bar cut (1D) - `src["physical"]`.
   A cut's record says which piece it came from, in the order the cuts were RECORDED. On the
   floor, bars are cut in the order sales are CONFIRMED (the cutting queue). With provisional
   offcuts the two can differ: a checkout cuts 5ft from an open window's 7ft leftover, but that
   window hasn't paid, so the 7ft doesn't exist - the bar is still whole. Whoever is confirmed
   first opens the bar. So:

       physical length = recorded source length
                         + cuts of sales ABOVE it on the bar that come later (an open window,
                           a released one, one confirmed after this order)
                         - cuts of sales BELOW it on the bar that come earlier (confirmed
                           before this order, or already reported cut)

   When that equals the record (every ordinary sale, manager corrections included) nothing is
   added and the worksheet reads exactly as before. When it differs the worksheet shows the
   real source - "New bar" or "the 16ft piece left after Order #356's cut" - and what is left.
   Example: a window cuts 14ft from a 21ft bar (7ft left, provisional); order 356 cuts 5ft of
   that 7ft and is confirmed first. Order 356: New bar, CUT 5, KEEP 16. The window, confirmed
   later: the 16ft piece left after Order #356's cut, CUT 14, KEEP 2. One bar, both sheets agree.

2. The `pending_source_notice` (a piece produced by a sale whose cut isn't reported yet):
   kept, with that sale's current receipt number, while it still applies; dropped once that
   cut is reported, and whenever (1) has replaced the source.
"""
import copy
from typing import Optional

from sqlmodel import Session, select

_LIVE = ("confirmed", "completed")  # sales whose cuts are going to happen


def _cut_entry(item, piece_id: int) -> Optional[tuple]:
    """(line_idx, src_idx, length_used) of the entry in `item` that consumed `piece_id`."""
    for li, line in enumerate((item.details or {}).get("lineItems") or []):
        if not isinstance(line, dict):
            continue
        for si, s in enumerate(line.get("offcut_sources") or []):
            if isinstance(s, dict) and s.get("source_piece_id") == piece_id and "cuts" not in s:
                return li, si, float(s.get("length_used") or 0)
    return None


def _event_cut(db: Session, piece) -> Optional[float]:
    """The length cut from `piece` by its (last) consumption, from the ledger's own event."""
    from entities.offcutLedger import OffcutPieceEvent

    ev = db.exec(select(OffcutPieceEvent).where(OffcutPieceEvent.piece_id == piece.piece_id,
                                                OffcutPieceEvent.event == "consumed")
                 .order_by(OffcutPieceEvent.seq.desc())).first()
    cut = ((ev.payload or {}).get("cut") or {}) if ev is not None else {}
    return float(cut["length"]) if cut.get("length") is not None else None


def _physical_1d(db: Session, order, item_id: Optional[int], src: dict) -> Optional[dict]:
    """The real source of one bar cut, or None when the record already says it (or it can't be
    worked out safely - then the record is shown, as always)."""
    from core.inventory import offcutLedger as ledger
    from entities.offcutLedger import GEOM_1D, ORIGIN_STOCK_UNIT, STATE_CONSUMED
    from entities.orderItems import OrderItem
    from entities.orders import Order
    from entities.variants import Variant

    if order is None or src.get("superseded") or "cuts" in src:
        return None
    piece = ledger.get_piece(db, src.get("source_piece_id"))
    if piece is None or piece.geom_kind != GEOM_1D:
        return None
    root = ledger.get_piece(db, piece.root_piece_id) if piece.root_piece_id else piece
    if root is None or root.origin != ORIGIN_STOCK_UNIT or not root.length:
        return None
    this_item = db.get(OrderItem, item_id) if item_id else None
    this_cut = bool(this_item and this_item.cutting_completed_at)

    def other_sale(p):
        """(order, item, cut length) of another sale's live claim on `p`, else None. 'abort'
        when the claim can't be read back - then nothing is overridden."""
        if p.state != STATE_CONSUMED or not p.consumed_by_item_id:
            return None
        item = db.get(OrderItem, p.consumed_by_item_id)
        if item is None or item.order_id == order.orderId:
            return None  # a dead claim, or this order's own (recorded in its own cutting order)
        o = db.get(Order, item.order_id)
        if o is None:
            return None
        entry = _cut_entry(item, p.piece_id)
        if entry is None:
            return "abort"
        return o, item, entry[2]

    def comes_first(o, item) -> bool:
        if o.status not in _LIVE:
            return False  # an open window, or a sale closed before cutting: never cut
        if item.cutting_completed_at and not this_cut:
            return True   # already cut
        return (o.created_at, o.orderId) < (order.created_at, order.orderId)

    length = float(src.get("offcut_length") or 0) if src.get("source") == "offcut" else float(root.length)
    named = None  # the sale whose cut leaves the piece this one comes from
    for a in ledger.ancestors(db, piece):
        if a.state == "retired" and a.superseded_by_piece_id and a.consumed_by_order_id != order.orderId:
            # Joined back (offcutLedger.join_into): that cut was confirmed never made - a released
            # window, or a sale reversed as "not cut" - so its length is still on the bar.
            cut = _event_cut(db, a)
            if cut is None:
                return None
            length += cut
            continue
        claim = other_sale(a)
        if claim == "abort":
            return None
        if claim and not comes_first(claim[0], claim[1]):
            length += claim[2]           # recorded as cut above us, but it happens later
        elif claim and (named is None or (claim[0].created_at, claim[0].orderId) > (named.created_at, named.orderId)):
            named = claim[0]
    for d in ledger.descendants(db, piece.piece_id):
        claim = other_sale(d)
        if claim == "abort":
            return None
        if claim and comes_first(claim[0], claim[1]):
            length -= claim[2]           # recorded as cut below us, but it happens first
            if named is None or (claim[0].created_at, claim[0].orderId) > (named.created_at, named.orderId):
                named = claim[0]
    length = round(length, 4)
    recorded = float(src.get("offcut_length") or 0) if src.get("source") == "offcut" else float(root.length)
    used = float(src.get("length_used") or 0)
    if abs(length - recorded) < 0.01 or length < used - 0.01 or length > float(root.length) + 0.01:
        return None
    keep = round(length - used, 4)
    variant = db.get(Variant, root.variant_id) if root.variant_id else None
    min_usable = (variant.min_usable if variant else None) or 0.0
    whole = abs(length - float(root.length)) < 0.01
    return {
        "kind": "new_bar" if whole else "piece",
        "length": length,
        "after_order_no": None if whole or named is None else (named.order_no or named.orderId),
        "keep": keep if keep > 0.01 else 0,
        "keep_status": None if keep <= 0.01 else ("scrap" if keep < min_usable else "available"),
    }


def _refresh_notice(db: Session, notice: dict) -> Optional[dict]:
    """The pending-source warning while it still applies (its sale confirmed, cut not reported)."""
    from entities.orderItems import OrderItem
    from entities.orders import Order

    item = db.get(OrderItem, notice.get("item_id")) if notice.get("item_id") else None
    if item is None:
        return notice  # nothing newer to say (an item replaced by an edit): as written
    if item.cutting_completed:
        return None    # cut and reported: the piece is real
    order = db.get(Order, item.order_id)
    if order is None or order.status not in _LIVE:
        return None    # an open window / a sale closed before cutting: the physical source covers it
    return {**notice, "order_id": order.orderId, "order_no": order.order_no,
            "customer_name": order.customer_name or notice.get("customer_name")}


def live_details(db: Optional[Session], details, order=None, item_id: Optional[int] = None):
    """A copy of an order item's details with each cut's physical source and source notice
    brought up to date (the stored record is never changed)."""
    if db is None or not isinstance(details, dict):
        return details
    lines = details.get("lineItems")
    if not isinstance(lines, list) or not any(
            isinstance(s, dict) and (s.get("source_piece_id") or s.get("pending_source_notice") or "physical" in s)
            for l in lines if isinstance(l, dict) for s in (l.get("offcut_sources") or [])):
        return details
    out = copy.deepcopy(details)
    for line in out["lineItems"]:
        if not isinstance(line, dict):
            continue
        for src in line.get("offcut_sources") or []:
            if not isinstance(src, dict):
                continue
            src.pop("physical", None)  # only ever worked out here; never trust a stored one
            physical = _physical_1d(db, order, item_id, src)
            if physical is not None:
                src["physical"] = physical
                src.pop("pending_source_notice", None)
            elif src.get("pending_source_notice"):
                fresh = _refresh_notice(db, src["pending_source_notice"])
                if fresh is None:
                    src.pop("pending_source_notice")
                else:
                    src["pending_source_notice"] = fresh
    return out
