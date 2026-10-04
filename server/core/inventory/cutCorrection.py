"""
"This source was never used" - the manager correction for a cutting event whose recorded
sheet/bar/offcut was never touched: the cutter took the pieces from somewhere else - and the
per-piece choice of where a re-supplied piece comes from.

What "never used" does, for one consumption event (and, for glass, every line sharing that sheet):
  1. The chain must say the source can come back WHOLE (offcutResolver with NOT_CUT). A source
     whose leftovers a live order has since cut into is refused with the reason - unlike an
     order edit, a correction reverses one event, not the whole item, so even this item's own
     later cuts count as holding it (item_id=None).
  2. Its recorded leftovers never existed: they are retired and leave the pool.
  3. Every piece it was supposed to supply is re-supplied from the manager's choice for THAT
     piece (resolve_assigned).
  4. The source itself goes where the manager says (FATES): back to stock/pool, back but not
     for this order, scrap, re-measured into one or more usable parts, or missing.
  5. The event moves from `offcut_sources` to `voided_sources`. Every reversal reader only
     reads `offcut_sources`, so a later edit/cancel can never hand this source back a second
     time; `voided_sources` is history only.

Source choices ("tokens"), per piece:
  "auto"          the engine's best fit (never the rejected original - see below)
  "new"           a fresh bar/sheet
  "<offcut id>"   that pool row
  "original:<k>"  part k of the never-used source as it goes back (0 = the whole of it)

Ordering matters for "auto": an offcut source is put back AFTER the replacement is resolved, so
the engine can't simply choose the piece that was just rejected. It goes back first only when a
piece was assigned to it on purpose, or when it is a whole bar/sheet (interchangeable stock).
"""
from collections import OrderedDict
from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from core.inventory import offcutLedger as ledger
from core.inventory import offcutResolver as resolver
from core.inventory import reversalPlan as rp
from core.inventory.poolKey import compute_pool_key
from entities.offcuts import Offcut
from entities.products import Product
from entities.variants import Variant
from config import nairobi_now

FATE_AVAILABLE = "available"   # still good - the cutter just used another piece
FATE_AVOID = "avoid"           # fine, but not for this order: the line becomes new-material-only
FATE_SCRAP = "scrap"           # damaged
FATE_REMEASURE = "remeasure"   # damaged, but one or more parts of it are usable
FATE_MISSING = "missing"       # doesn't exist
FATES = (FATE_AVAILABLE, FATE_AVOID, FATE_SCRAP, FATE_REMEASURE, FATE_MISSING)

_EPS = 0.5  # mm / 0.5 of a bar unit is far coarser than needed; see _validate_parts


def plan_unused(db: Session, src: dict, is_2d: bool):
    """The resolver's verdict for "this source was never cut", or a ValueError naming why it
    can't come back whole."""
    rev = resolver.resolve_source(db, src, item_id=None, is_2d=is_2d, physical_state=rp.PHYS_NOT_CUT)
    if rev.is_legacy:
        raise ValueError("This cut was recorded before material tracking began, so its source can't be "
                         "put back exactly. Mark the missed cuts and correct the remainders instead.")
    if not rev.reversible:
        why = rev.detail.split(" — ", 1)[-1]
        raise ValueError(f"Can't mark this source as never used: {why}. Correct the later cut first.")
    return rev


def remeasure_parts(remeasure) -> list:
    """The usable parts of a re-measured source, as a list (one dict is accepted too)."""
    if not remeasure:
        return []
    return [remeasure] if isinstance(remeasure, dict) else list(remeasure)


def parts_entered(remeasure, is_2d: bool) -> bool:
    parts = remeasure_parts(remeasure)
    keys = ("width", "height") if is_2d else ("length",)
    return bool(parts) and all(float(p.get(k) or 0) > 0 for p in parts for k in keys)


def _validate_parts(remeasure, is_2d: bool, piece) -> None:
    if not parts_entered(remeasure, is_2d):
        raise ValueError("Enter the real size of every usable part of the original source")
    parts = remeasure_parts(remeasure)
    if piece is None:
        return
    if is_2d:
        sw, sh = float(piece.width or 0), float(piece.height or 0)
        for p in parts:
            w, h = float(p["width"]), float(p["height"])
            if not ((w <= sw + _EPS and h <= sh + _EPS) or (w <= sh + _EPS and h <= sw + _EPS)):
                raise ValueError(f"A {w:.0f}x{h:.0f}mm part can't come out of a {sw:.0f}x{sh:.0f}mm source")
        if sum(float(p["width"]) * float(p["height"]) for p in parts) > sw * sh + _EPS:
            raise ValueError("The usable parts add up to more glass than the source had")
    else:
        if sum(float(p["length"]) for p in parts) > float(piece.length or 0) + 0.01:
            raise ValueError(f"The usable parts add up to more than the {float(piece.length or 0):.2f} the source had")


def _validate(fate: str, remeasure, is_2d: bool, full_unit: bool, uses_original: bool, piece=None) -> None:
    if fate not in FATES:
        raise ValueError(f"Unknown choice for the original source: {fate}")
    if fate == FATE_REMEASURE:
        _validate_parts(remeasure, is_2d, piece)
    if fate == FATE_AVOID and full_unit:
        raise ValueError("A new bar/sheet goes back to stock - 'not for this order' only applies to an offcut")
    if uses_original and (full_unit or fate not in (FATE_AVAILABLE, FATE_REMEASURE)):
        raise ValueError("The original source can only be chosen again when it goes back as usable stock")


def _retire_remainders(db, product, variant, rev, pool_key: str) -> list:
    from core.inventory.inventoryService import _drop_pooled_unit_for_piece

    gone = []
    for p in rev.remainder_pieces:
        if p.state != ledger.STATE_AVAILABLE:
            continue  # a leftover already deleted by hand - nothing in the pool
        _drop_pooled_unit_for_piece(db, product, variant, p, pool_key)
        ledger.retire_piece(db, p, reason="its source was never used (manager correction)")
        gone.append(p.piece_id)
    return gone


def _return_source(db, product, variant, rev, is_2d: bool, fate: str, remeasure, pool_key: str) -> list:
    """Put the never-used source where the manager says. Returns the pool row of each part that
    went back as usable stock, indexed like the "original:<k>" token (None for a part too small
    to use); empty when nothing went back into the offcut pool."""
    from core.inventory.glassOffcutService import _is_scrap, _restore_sheet_stock, _upsert_glass_offcut
    from core.inventory.inventoryService import (
        _is_scrap_1d, _restore_simple_stock, _return_pooled_unit_for_piece, _upsert_offcut,
    )

    piece = rev.source_piece
    full_unit = rev.kind == resolver.KIND_FULL_UNIT

    if fate == FATE_MISSING:
        ledger.retire_piece(db, piece, reason="source never used - reported missing")
        return []

    if fate in (FATE_AVAILABLE, FATE_AVOID):
        if full_unit:
            (_restore_sheet_stock if is_2d else _restore_simple_stock)(db, product, variant, 1)
            # A stock unit again, not a piece in the offcut pool (see _restore_one_source).
            ledger.retire_piece(db, piece, reason="source never used - whole unit back to stock")
            return []
        _return_pooled_unit_for_piece(db, product, variant, piece, pool_key)
        ledger.release_piece(db, piece, reason="source never used (manager correction)")
        return [piece.offcut_row_id]

    # Scrap / re-measured: other piece(s) take its place, linked as its correction.
    if fate == FATE_SCRAP:
        parts = [{"width": piece.width, "height": piece.height} if is_2d else {"length": piece.length}]
    else:
        parts = remeasure_parts(remeasure)
    rows, new_pieces = [], []
    for part in parts:
        out: dict = {}
        if is_2d:
            w, h = float(part["width"]), float(part["height"])
            status = "scrap" if fate == FATE_SCRAP or _is_scrap((w, h), variant) else "available"
            row_id = _upsert_glass_offcut(db, product, variant, w, h, status, pool_key=pool_key, parent_piece=piece,
                                          origin=ledger.ORIGIN_CORRECTION, ledger_out=out,
                                          ledger_notes=f"never-used source, {fate}")
        else:
            length = float(part["length"])
            status = "scrap" if fate == FATE_SCRAP or _is_scrap_1d(length, variant) else "available"
            row_id = _upsert_offcut(db, product, variant, length, pool_key=pool_key, status=status, parent_piece=piece,
                                    origin=ledger.ORIGIN_CORRECTION, ledger_out=out,
                                    ledger_notes=f"never-used source, {fate}")
        rows.append(row_id if status == "available" else None)
        new_pieces.append(ledger.get_piece(db, out.get("piece_id")))
    ledger.record_correction(db, piece, new_pieces, notes=f"source never used - {fate}")
    return rows if fate == FATE_REMEASURE else []


def _token(forced_offcut_id=None, force_new=False, use_original=False, original_part=0) -> str:
    """The single replacement choice of the older request fields, as a token."""
    if use_original:
        return f"original:{int(original_part or 0)}"
    if force_new:
        return "new"
    if forced_offcut_id is not None:
        return str(int(forced_offcut_id))
    return "auto"


def _original_row(token: str, original_rows: list) -> int:
    k = int(token.split(":", 1)[1])
    row = original_rows[k] if 0 <= k < len(original_rows) else None
    if row is None:
        raise ValueError("That part of the original is too small to cut from - choose another source")
    return row


def _void(line: dict, event: dict, fate: str) -> None:
    line["offcut_sources"] = [e for e in (line.get("offcut_sources") or []) if e is not event]
    line.setdefault("voided_sources", []).append({
        **event, "voided": {"reason": "source_never_used", "fate": fate, "at": nairobi_now().isoformat()},
    })
    # A manual pick named the source that wasn't used; the line's material is now whatever
    # replaced it, so a later re-cut must not go looking for that piece again.
    line.pop("offcut_selection", None)


def _rows_snapshot(db, row_ids: list) -> list:
    out = []
    for rid in row_ids:
        row = db.get(Offcut, rid) if rid else None
        out.append(None if row is None else
                   {"offcut_id": row.offcutId, "width": row.width, "height": row.height, "length": row.length})
    return out


# -- Glass ---------------------------------------------------------------------------------

def _glass_group(line_items: list, line_idx: int, event_idx: int) -> list:
    """[(line_idx, event)] for the owning event and every line sharing its sheet."""
    owner = line_items[line_idx]["offcut_sources"][event_idx]
    members = [(line_idx, owner)]
    gid = owner.get("group_id")
    if gid is not None:
        for li, line in enumerate(line_items):
            if li == line_idx or not isinstance(line, dict):
                continue
            for ev in line.get("offcut_sources") or []:
                if ev.get("group_id") == gid:
                    members.append((li, ev))
    return members


def group_pieces(line_items: list, line_idx: int, event_idx: int, refs: Optional[list]) -> list:
    """The pieces to re-supply, [{line_idx, cut_idx, width, height}]: every cut on the sheet
    (refs None), or the ones a missed-cut correction names ({line_idx, cut_idx} across the
    lines sharing the sheet). (line_idx, cut_idx) is how a per-piece choice names a piece."""
    group = _glass_group(line_items, line_idx, event_idx)
    if refs is None:
        return [{"line_idx": li, "cut_idx": k, "width": c["width"], "height": c["height"]}
                for li, ev in group for k, c in enumerate(ev.get("cuts") or [])]
    members = {li: ev for li, ev in group}
    out = []
    for r in refs:
        cuts = (members.get(r["line_idx"]) or {}).get("cuts") or []
        if 0 <= r["cut_idx"] < len(cuts):
            c = cuts[r["cut_idx"]]
            out.append({"line_idx": r["line_idx"], "cut_idx": r["cut_idx"], "width": c["width"], "height": c["height"]})
    return out


def assignment_map(assignments) -> dict:
    """{(line_idx, cut_idx): token} from the request's per-piece choices."""
    out = {}
    for a in assignments or []:
        a = a if isinstance(a, dict) else a.model_dump()
        out[(int(a["line_idx"]), int(a["cut_idx"]))] = str(a.get("source") or "auto")
    return out


def resolve_assigned(db: Session, product: Product, variant: Optional[Variant], pieces: list,
                     original_rows: Optional[list] = None, item_id: Optional[int] = None) -> tuple:
    """Supply each piece from the source chosen for it. `pieces`: [{line, width, height, source}]
    (`line` is whatever key the caller attributes events back to). Pieces sharing a source are
    packed into it together; a chosen offcut that can't hold every piece given to it is refused
    rather than quietly overflowing somewhere else.

    Returns (events, {line: [events]}). Chosen offcuts are cut first, then new sheets, then the
    best fit - so the engine can't take an offcut a piece was explicitly given. `item_id`: the
    order item the pieces are for, recorded in the ledger as holding what is taken."""
    from core.inventory.glassOffcutService import (
        _apply_candidate, _candidate_sort_key, _fulfill_pool, _generate_candidates, _get_full_dims,
    )

    full_w, full_h = _get_full_dims(variant)
    pool_key = compute_pool_key(db, variant)
    groups: "OrderedDict[str, list]" = OrderedDict()
    for p in pieces:
        groups.setdefault(p["source"], []).append(p)

    def rank(token):
        return 2 if token == "auto" else 1 if token == "new" else 0

    flat, by_line = [], {}
    for token in sorted(groups, key=rank):
        needs, owner = [], {}
        for p in groups[token]:
            key = (p["line"], round(float(p["width"]), 3), round(float(p["height"]), 3))
            need = next((n for n in needs if n["_key"] == key), None)
            if need is None:
                need = {"line_idx": len(needs), "piece_w": float(p["width"]), "piece_h": float(p["height"]),
                        "remaining": 0, "_key": key}
                owner[need["line_idx"]] = p["line"]
                needs.append(need)
            need["remaining"] += 1

        row, label = None, None
        if token.startswith("original:"):
            row, label = _original_row(token, original_rows or []), "The original"
        elif token.isdigit():
            row, label = int(token), f"Offcut #{token}"
        elif token not in ("new", "auto"):
            raise ValueError(f"Unknown replacement source: {token}")

        while any(n["remaining"] > 0 for n in needs):
            if token == "auto":
                events = _fulfill_pool(db, product, variant, needs, full_w, full_h, item_id=item_id, pool_key=pool_key)
            else:
                cands = _generate_candidates(db, product, variant, needs, full_w, full_h, pool_key=pool_key)
                if token == "new":
                    cands = [c for c in cands if c["source_kind"] == "sheet"]
                    if not cands:
                        raise ValueError(f"The piece(s) don't fit a full sheet ({full_w:.0f}x{full_h:.0f}mm)")
                else:
                    cands = [c for c in cands if c["source_kind"] == "offcut" and c["source_id"] == row]
                    if not cands:
                        left = sum(n["remaining"] for n in needs)
                        raise ValueError(f"{label} can't hold {'all the pieces' if left > 1 else 'the piece'} "
                                         "you chose for it - choose another source for some of them")
                now = nairobi_now()
                best = min(cands, key=lambda c: _candidate_sort_key(c, variant, now))
                events = _apply_candidate(db, product, variant, best, item_id, pool_key=pool_key)
            for need_idx, ev in events.items():
                flat.append(ev)
                by_line.setdefault(owner[need_idx], []).append(ev)
                needs[need_idx]["remaining"] -= len(ev.get("cuts") or [])
    return flat, by_line


def glass_source_unused(db: Session, product: Product, variant: Optional[Variant], line_items: list,
                        line_idx: int, event_idx: int, *, fate: str = FATE_AVAILABLE, remeasure=None,
                        forced_offcut_id: Optional[int] = None, force_new_sheet: bool = False,
                        use_original: bool = False, original_part: int = 0, assignments=None,
                        item_id: Optional[int] = None) -> dict:
    """Mutates `line_items` in place. See the module docstring."""
    event = line_items[line_idx]["offcut_sources"][event_idx]
    if "cuts" not in event or not event.get("owns_consumption", True):
        raise ValueError("Correct the event that owns this sheet's consumption")
    rev = plan_unused(db, event, True)
    full_unit = rev.kind == resolver.KIND_FULL_UNIT
    default = _token(forced_offcut_id, force_new_sheet, use_original, original_part)
    chosen = assignment_map(assignments)
    pieces = [{**p, "line": p["line_idx"], "source": chosen.get((p["line_idx"], p["cut_idx"]), default)}
              for p in group_pieces(line_items, line_idx, event_idx, None)]
    uses_original = any(p["source"].startswith("original:") for p in pieces)
    _validate(fate, remeasure, True, full_unit, uses_original, rev.source_piece)
    pool_key = compute_pool_key(db, variant)
    members = _glass_group(line_items, line_idx, event_idx)

    _retire_remainders(db, product, variant, rev, pool_key)
    returned_first = full_unit or uses_original
    original_rows = _return_source(db, product, variant, rev, True, fate, remeasure, pool_key) if returned_first else []
    replacement, by_line = (resolve_assigned(db, product, variant, pieces, original_rows, item_id=item_id)
                            if pieces else ([], {}))
    if not returned_first:
        original_rows = _return_source(db, product, variant, rev, True, fate, remeasure, pool_key)

    for li, ev in members:
        _void(line_items[li], ev, fate)
        if fate == FATE_AVOID:
            line_items[li]["source_pref"] = "new"
    for li, evs in by_line.items():
        line_items[li].setdefault("offcut_sources", []).extend(evs)

    return {
        "before": list(event.get("remainders_created") or []), "after": [],
        "replacement_events": replacement, "replacement_events_by_line": by_line,
        "voided_lines": sorted({li for li, _ in members}), "fate": fate,
        "original": _rows_snapshot(db, original_rows),
    }


def glass_piece_options(db: Session, product: Product, variant: Optional[Variant], pieces: list,
                        original_rows: Optional[list] = None, exclude_row: Optional[int] = None) -> dict:
    """For each piece to re-supply ({line_idx, cut_idx, width, height}), which sources can cut
    it: offcuts (with the pieces each fits, by position in `pieces`), the original's parts, and
    whether a new sheet fits. Read-only; called inside a dry run."""
    from core.inventory.glassOffcutService import _generate_candidates, _get_full_dims

    full_w, full_h = _get_full_dims(variant)
    pool_key = compute_pool_key(db, variant)
    originals = {rid: k for k, rid in enumerate(original_rows or []) if rid}
    fits: dict = {}
    sheet_fits = []
    by_dims: dict = {}
    for pos, p in enumerate(pieces):
        by_dims.setdefault((round(float(p["width"]), 3), round(float(p["height"]), 3)), []).append(pos)
    for (w, h), positions in by_dims.items():
        need = [{"line_idx": 0, "piece_w": w, "piece_h": h, "remaining": 1}]
        for c in _generate_candidates(db, product, variant, need, full_w, full_h, pool_key=pool_key):
            if c["source_kind"] == "sheet":
                sheet_fits += positions
            elif c["source_id"] != exclude_row:
                fits.setdefault(c["source_id"], (c["source_w"], c["source_h"], []))[2].extend(positions)
    offcuts = []
    for rid, (w, h, positions) in fits.items():
        row = db.get(Offcut, rid)
        offcuts.append({"offcutId": rid, "width": w, "height": h, "quantity": row.quantity if row else 1,
                        "original": originals.get(rid), "fits": sorted(positions)})
    offcuts.sort(key=lambda o: (o["original"] is None, o["width"] * o["height"]))
    return {"pieces": pieces, "offcuts": offcuts,
            "sheet": {"fits": sorted(sheet_fits), "stock": _unit_stock(variant)}}


# -- Profiles / bars -----------------------------------------------------------------------

def profile_source_unused(db: Session, product: Product, variant: Optional[Variant], line: dict,
                          event_idx: int, *, fate: str = FATE_AVAILABLE, remeasure=None,
                          forced_offcut_id: Optional[int] = None, force_new_bar: bool = False,
                          use_original: bool = False, original_part: int = 0,
                          item_id: Optional[int] = None) -> dict:
    """Mutates `line` in place. See the module docstring."""
    from core.inventory.inventoryService import resolve_profile_replacement

    event = line["offcut_sources"][event_idx]
    if "cuts" in event or "remainders_created" in event:
        raise ValueError("This cutting event isn't a 1D bar cut")
    if event.get("superseded"):
        raise ValueError("This cut was already moved to another source by an earlier correction")
    rev = plan_unused(db, event, False)
    full_unit = rev.kind == resolver.KIND_FULL_UNIT
    _validate(fate, remeasure, False, full_unit, use_original, rev.source_piece)
    pool_key = compute_pool_key(db, variant)

    _retire_remainders(db, product, variant, rev, pool_key)
    returned_first = full_unit or use_original
    original_rows = _return_source(db, product, variant, rev, False, fate, remeasure, pool_key) if returned_first else []
    if use_original:
        forced_offcut_id = _original_row(f"original:{int(original_part or 0)}", original_rows)
    replacement = resolve_profile_replacement(db, product, variant, float(event.get("length_used") or 0),
                                              forced_offcut_id, force_new_bar, item_id=item_id)
    if not returned_first:
        original_rows = _return_source(db, product, variant, rev, False, fate, remeasure, pool_key)

    before = {k: event.get(k) for k in ("source", "offcut_id", "offcut_length", "length_used",
                                        "remainder_created", "remainder_status")}
    _void(line, event, fate)
    if fate == FATE_AVOID:
        line["source_pref"] = "new"
    line.setdefault("offcut_sources", []).append(replacement)
    return {"before": before, "after": None, "replacement_event": replacement, "fate": fate,
            "original": _rows_snapshot(db, original_rows)}


def profile_candidates(db: Session, product: Product, variant: Optional[Variant], length: float,
                       original_rows: Optional[list] = None, exclude_row: Optional[int] = None) -> dict:
    """Offcuts long enough for `length` (one piece supplies a corrected cut), and bar stock."""
    originals = {rid: k for k, rid in enumerate(original_rows or []) if rid}
    rows = db.exec(select(Offcut).where(
        Offcut.product_id == product.productId, Offcut.pool_key == compute_pool_key(db, variant),
        Offcut.status == "available", Offcut.quantity > 0, Offcut.length >= length - 0.001,
    ).order_by(Offcut.length.asc())).all()
    offcuts = [{"offcutId": r.offcutId, "length": r.length, "quantity": r.quantity, "original": originals.get(r.offcutId)}
               for r in rows if r.offcutId != exclude_row and (r.width is None or r.width == 0)]
    offcuts.sort(key=lambda o: o["original"] is None)
    return {"offcuts": offcuts, "bar": {"stock": _unit_stock(variant)}}


def _unit_stock(variant: Optional[Variant]) -> float:
    return float(variant.stock_quantity or 0) if variant is not None else 0.0
