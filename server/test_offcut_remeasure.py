"""
CEO offcut correction (Offcut Management -> edit a row's size/count) and the offcut ledger.

The correction re-measures a row's pieces IN PLACE (offcutLedger.resync_row_pieces) and logs a
`corrected` event on each. `corrected` is also what record_correction writes when a piece is
REPLACED by new ones, and everything that folds the event log used to read every `corrected`
as "retired". So a re-measured piece, still available, looked retired to:

  - the integrity check            ("cached available but its events say retired")
  - offcutLedger.rebuild_piece_state  (would have retired a real piece)
  - offcutResolver.vanished_leftover  (a re-measured leftover deleted by hand afterwards blocked
                                       a 'not cut' reversal, unlike any other deleted leftover)

Seen on the shop data of 2026-10-03: 11 such pieces (Obs Brown row 17168, Bottom Sash row 12824).

Runs against emiratesco_edit_test only (it truncates tables):

    python test_offcut_remeasure.py
"""
from sqlmodel import select

import test_edit_scenarios as E
import test_order_edit_matrix as M
from core.audit import integrity
from core.inventory import offcutLedger as ledger
from core.inventory import offcutResolver as resolver
from core.inventory.products import model as product_model
from core.inventory.products import service as product_service
from entities.offcutLedger import OffcutPiece, OffcutPieceEvent
from entities.offcuts import Offcut

check = M.check
failures = M.failures


def ceo_of(w):
    ceo = M.FakeUser(str(w.user.userId))
    ceo.role = "ceo"
    return ceo


def row_of(db, product):
    return db.exec(select(Offcut).where(Offcut.product_id == product.productId,
                                        Offcut.quantity > 0)).first()


def pieces_on(db, row_id, state=None):
    q = select(OffcutPiece).where(OffcutPiece.offcut_row_id == row_id)
    if state:
        q = q.where(OffcutPiece.state == state)
    return db.exec(q.order_by(OffcutPiece.piece_id.asc())).all()


def events_of(db, piece):
    return [e.event for e in db.exec(select(OffcutPieceEvent).where(
        OffcutPieceEvent.piece_id == piece.piece_id).order_by(OffcutPieceEvent.seq.asc())).all()]


def rebuild_changes(db, pieces):
    """rebuild_piece_state on each piece; returns the (piece, before, after) that moved."""
    moved = []
    for p in pieces:
        before = (p.state, p.consumed_by_item_id)
        ledger.rebuild_piece_state(db, p.piece_id)
        db.flush()
        db.refresh(p)
        if (p.state, p.consumed_by_item_id) != before:
            moved.append((p.piece_id, before, (p.state, p.consumed_by_item_id)))
    return moved


def correct(w, row, **fields):
    product_service.update_offcut_admin(row.offcutId, product_model.OffcutAdminUpdate(**fields), w.db, ceo_of(w))
    w.db.commit()
    w.db.expire_all()


# ─────────────────────────────────────────────────────────────────────────────
def r1():
    print("\n--- R1. 1D leftover re-measured in place stays a live, consistent piece ---")
    w = E.World()
    a, ai = w.sale(6)
    row = row_of(w.db, w.bar)
    check("before: 15 left", (w.stock(), w.pool()), (39, [15.0]))
    correct(w, row, length=14.0)
    check("pool shows the new size", w.pool(), [14.0])
    (piece,) = pieces_on(w.db, row.offcutId)
    check("piece re-measured in place", (piece.state, piece.length), ("available", 14.0))
    check("its log says corrected", events_of(w.db, piece)[-1], "corrected")
    w.ok("R1 after correction")
    check("rebuild leaves it alone", rebuild_changes(w.db, [piece]), [])
    w.db.rollback()

    # A later order cuts from the re-measured piece, then is cancelled as not cut.
    b, bi = w.sale(5)
    w.db.expire_all()
    piece = w.db.get(OffcutPiece, piece.piece_id)
    check("later order consumed the re-measured piece", (piece.state, piece.consumed_by_item_id),
          ("consumed", bi.item_id))
    check("rebuild agrees it is consumed", rebuild_changes(w.db, [piece]), [])
    w.db.rollback()
    w.ok("R1 after later cut")
    w.cancel(b, bi, E.NOT_CUT)
    w.db.expire_all()
    check("cancelled as not cut: the 14 is whole again", (w.stock(), w.pool()), (39, [14.0]))
    w.ok("R1 after cancel")
    w.close()


def r2():
    print("\n--- R2. Piece count corrected up and down ---")
    w = E.World()
    w.sale(6)
    row = row_of(w.db, w.bar)
    correct(w, row, quantity=3)
    avail = pieces_on(w.db, row.offcutId, "available")
    check("count up mints pieces", (w.pool(), len(avail)), ([15.0, 15.0, 15.0], 3))
    w.ok("R2 after count up")
    correct(w, row, quantity=1, length=13.0)
    every = pieces_on(w.db, row.offcutId)
    check("count down retires the surplus, keeps one re-measured",
          sorted((p.state, p.length) for p in every),
          [("available", 13.0), ("retired", 15.0), ("retired", 15.0)])
    w.ok("R2 after count down")
    check("rebuild changes nothing", rebuild_changes(w.db, every), [])
    w.db.rollback()
    w.close()


def r3():
    print("\n--- R3. Re-measured leftover then deleted by hand: 'not cut' gives the bar back whole (as S15) ---")
    w = E.World()
    a, ai = w.sale(6)
    row = row_of(w.db, w.bar)
    correct(w, row, length=14.5)
    product_service.bulk_delete_offcuts([row.offcutId], w.db, ceo_of(w))
    w.db.commit()
    check("deleted by hand", w.pool(), [])
    (piece,) = pieces_on(w.db, row.offcutId) or pieces_on_any(w.db, w.bar)
    check("a hand-deleted re-measured leftover counts as vanished", resolver.vanished_leftover(w.db, piece), True)
    line = w.plan_for(a, ai)["lines"][0]
    check("'not cut' promises the whole bar", line["returns"].get("not_cut"), ["the whole bar back to stock"])
    w.cancel(a, ai, E.NOT_CUT)
    check("the whole bar is back in stock", (w.stock(), w.pool()), (40, []))
    w.ok("R3")
    w.close()

    print("\n--- R3b. Same, cut WAS made: only the cut piece comes back (as S15b) ---")
    w = E.World()
    a, ai = w.sale(6, cut_done=True)
    row = row_of(w.db, w.bar)
    correct(w, row, length=14.5)
    product_service.bulk_delete_offcuts([row.offcutId], w.db, ceo_of(w))
    w.db.commit()
    w.cancel(a, ai, E.CUT)
    check("the 6 comes back, the deleted leftover stays gone", (w.stock(), w.pool()), (39, [6.0]))
    w.ok("R3b")
    w.close()


def pieces_on_any(db, product):
    return db.exec(select(OffcutPiece).where(OffcutPiece.product_id == product.productId,
                                             OffcutPiece.origin == "cut_remainder")).all()


def r4():
    print("\n--- R4. Re-measured leftover that a later order USED still blocks 'not cut' ---")
    w = E.World()
    a, ai = w.sale(6)
    row = row_of(w.db, w.bar)
    correct(w, row, length=14.0)
    b, bi = w.sale(10)
    w.db.expire_all()
    (piece,) = pieces_on_any(w.db, w.bar)[:1]
    check("not vanished: another order cut it", resolver.vanished_leftover(w.db, piece), False)
    line = w.plan_for(a, ai)["lines"][0]
    check("the later cut is named as a blocker", [lc["order_id"] for lc in line["later_cuts"]], [b.orderId])
    w.ok("R4")
    w.close()


def r5():
    print("\n--- R5. A REPLACEMENT correction (record_correction) still retires the old piece ---")
    w = E.World()
    w.sale(6)
    row = row_of(w.db, w.bar)
    (old,) = pieces_on(w.db, row.offcutId)
    new = ledger.mint_piece(w.db, product_id=w.bar.productId, variant_id=w.var.variantId,
                            pool_key=row.pool_key or "", geom={"geom_kind": "1d", "length": 15.0,
                                                               "width": None, "height": None},
                            origin="manual_entry", offcut_row_id=row.offcutId)
    w.db.flush()
    ledger.record_correction(w.db, old, [new], notes="replaced")
    w.db.commit()
    w.db.refresh(old)
    check("old piece retired and superseded", (old.state, old.superseded_by_piece_id), ("retired", new.piece_id))
    check("rebuild keeps it retired", rebuild_changes(w.db, [old]), [])
    w.db.rollback()
    check("a replaced piece is not 'vanished'", resolver.vanished_leftover(w.db, old), False)
    w.close()   # before the next World: its TRUNCATE waits on any open transaction

    # Replaced with nothing: retired, no successor - still not a hand deletion.
    w2 = E.World()
    w2.sale(6)
    row2 = row_of(w2.db, w2.bar)
    (old2,) = pieces_on(w2.db, row2.offcutId)
    ledger.record_correction(w2.db, old2, [], notes="written off")
    w2.db.commit()
    w2.db.refresh(old2)
    check("replaced-by-nothing is retired", old2.state, "retired")
    check("rebuild keeps it retired", rebuild_changes(w2.db, [old2]), [])
    w2.db.rollback()
    check("replaced-by-nothing is not 'vanished'", resolver.vanished_leftover(w2.db, old2), False)
    w2.close()


def r6():
    print("\n--- R6. 2D glass leftover re-measured in place ---")
    w = E.World()
    glass, gvar = M.seed_product(w.db, w.cat, "Remeasure Glass", kind="glass")
    w.db.commit()
    o = M.new_order(w.db, w.user)
    M.add_item(w.db, o, glass, gvar, [M.line_cut_2d(1000, 1000)])
    w.db.commit()
    rows = w.db.exec(select(Offcut).where(Offcut.product_id == glass.productId, Offcut.quantity > 0)
                     .order_by(Offcut.offcutId.asc())).all()
    target = max(rows, key=lambda r: r.width * r.height)
    # The new size, worked out BEFORE the edit: re-reading target.width afterwards would
    # compare the result with itself, and a correction that did nothing would still pass.
    want_w, want_h = target.width - 10, target.height
    correct(w, target, width=want_w, height=want_h)
    w.db.expire_all()
    check("the row itself has the new size", (target.width, target.height), (want_w, want_h))
    pieces = pieces_on(w.db, target.offcutId)
    check("2D piece re-measured, still available",
          [(p.state, p.width, p.height) for p in pieces], [("available", want_w, want_h)])
    w.ok("R6")
    check("rebuild changes nothing", rebuild_changes(w.db, pieces), [])
    w.db.rollback()
    w.close()


def main():
    for fn in (r1, r2, r3, r4, r5, r6):
        fn()
    print()
    if failures:
        print(f"{len(failures)} FAILED:")
        for f in failures:
            print("  -", f)
        raise SystemExit(1)
    print("All re-measure checks passed.")


if __name__ == "__main__":
    main()
