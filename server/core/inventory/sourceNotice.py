"""What the cutter is told about a cut's source - worked out when an order is SHOWN, never stored.

Two things are brought up to date for every order shown (the worksheet, the order screens, the
cutting queue), on a copy of its details:

1. The PHYSICAL source of a bar cut (1D) - `src["physical"]`.
   A cut's record says which piece it came from, in the order the cuts were RECORDED. On the
   floor, bars are cut in the order sales are CONFIRMED (the cutting queue). With provisional
   offcuts the two can differ: a checkout cuts 5ft from an open window's 7ft leftover, but that
   window hasn't paid, so the 7ft doesn't exist - the bar is still whole. Whoever is confirmed
   first opens the bar.

   A bar's records are one chain (each cut of a piece leaves at most one leftover; a rejoin
   hangs off the end), so physically the bar just gets shorter, one real cut at a time:

       physical length = bar length - the cuts on that bar that come FIRST
                         (sales confirmed before this one, cuts already reported done, and
                          this order's own earlier cuts on the bar)

   An open window, a released one and a sale reversed "not cut" never come first. When the cuts
   recorded ABOVE this one on the chain are exactly the ones that come first - every ordinary
   sale, manager corrections included - the record is right and nothing is added. Otherwise the
   worksheet shows the real source, "New bar" or "the 16ft piece left after Order #356's cut",
   and what is really left.
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


def _physical_1d(db: Session, order, item_id: Optional[int], pos: tuple, src: dict) -> Optional[dict]:
    """The real source of one bar cut, or None when the record already says it (or it can't be
    worked out safely - then the record is shown, as always). `pos` = (line_idx, src_idx) of
    `src` in its item, to order this order's own cuts on the same bar."""
    from core.inventory import offcutLedger as ledger
    from entities.offcutLedger import GEOM_1D, ORIGIN_STOCK_UNIT, STATE_CONSUMED, OffcutPiece
    from entities.orderItems import OrderItem
    from entities.orders import Order
    from entities.variants import Variant

    if order is None or src.get("superseded") or "cuts" in src:
        return None
    piece = ledger.get_piece(db, src.get("source_piece_id"))
    if piece is None or piece.geom_kind != GEOM_1D or not piece.root_piece_id:
        return None
    # The whole bar's chain in one query.
    chain = {p.piece_id: p for p in db.exec(select(OffcutPiece).where(
        OffcutPiece.root_piece_id == piece.root_piece_id)).all()}
    root = chain.get(piece.root_piece_id)
    if root is None or root.origin != ORIGIN_STOCK_UNIT or not root.length:
        return None
    this_item = db.get(OrderItem, item_id) if item_id else None
    this_cut = bool(this_item and this_item.cutting_completed_at)
    me = (item_id or 0,) + tuple(pos)

    first, first_len, named = set(), 0.0, None
    for p in chain.values():
        if p.piece_id == piece.piece_id or p.state != STATE_CONSUMED or not p.consumed_by_item_id:
            continue
        item = db.get(OrderItem, p.consumed_by_item_id)
        if item is None:
            continue  # a dead claim (the item was replaced): that cut never happens
        o = db.get(Order, item.order_id)
        entry = _cut_entry(item, p.piece_id)
        if o is None or entry is None:
            return None  # can't read that cut back: show the record
        if o.orderId == order.orderId:
            comes_first = (item.item_id, entry[0], entry[1]) < me
        elif o.status not in _LIVE:
            comes_first = False  # an open window, or a sale closed before cutting
        else:
            comes_first = ((item.cutting_completed_at is not None and not this_cut)
                           or (o.created_at, o.orderId) < (order.created_at, order.orderId))
            if comes_first and (named is None or (o.created_at, o.orderId) > (named.created_at, named.orderId)):
                named = o
        if comes_first:
            first.add(p.piece_id)
            first_len += entry[2]

    # The cuts the record says came before this one: everything above it on the chain that was
    # cut from (a joined-back piece keeps the order that had claimed it; a released one doesn't).
    above, cur = set(), piece
    while cur.parent_piece_id in chain:
        cur = chain[cur.parent_piece_id]
        if cur.consumed_by_order_id is not None:
            above.add(cur.piece_id)
    if above == first:
        return None

    length = round(float(root.length) - first_len, 4)
    used = float(src.get("length_used") or 0)
    if length < used - 0.01 or length > float(root.length) + 0.01:
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
    for li, line in enumerate(out["lineItems"]):
        if not isinstance(line, dict):
            continue
        for si, src in enumerate(line.get("offcut_sources") or []):
            if not isinstance(src, dict):
                continue
            src.pop("physical", None)  # only ever worked out here; never trust a stored one
            physical = _physical_1d(db, order, item_id, (li, si), src)
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
