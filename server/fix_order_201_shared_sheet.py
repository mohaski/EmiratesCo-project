"""
Correct the stock left wrong by order 201's edit (2026-09-28 00:19).

WHAT HAPPENED
The old 5mm O/w Blue item cut two lines from ONE physical sheet (ledger piece 19352):
    540x1020 x2  — a SHARED event   — confirmed "already cut"
    550x1100 x2  — the OWNING event — confirmed "not cut"
Shared events were a no-op on reversal, so the "already cut" answer was ignored, and the
owning line's "not cut" put the WHOLE sheet back in stock and retired its three remainders.
Physically the sheet has two 540x1020 pieces cut out of it, so:
    - stock holds one 5mm sheet too many
    - the two cut 540x1020 pieces are recorded nowhere
    - the rest of the sheet (uncut) is recorded nowhere either

WHAT THIS DOES — exactly what the fixed restore_glass_cut_lines does for that case
(a sheet counts as cut if any line on it is):
    1. take the phantom 5mm sheet back out of stock
    2. put every piece of that sheet into the offcut pool, parented to the sheet in the
       ledger: the 2 cut 540x1020 pieces, the uncut 550x1100 area as the 2 pieces it is
       laid out for, and the 3 remainders the reversal retired
Area check: those 7 pieces add up to the full 1650x2140 sheet.

    python fix_order_201_shared_sheet.py            # dry run
    python fix_order_201_shared_sheet.py --apply
"""
import sys

from sqlmodel import Session, select

from db.database import engine

import entities  # noqa: F401
from entities.editHistory import EditHistory
from entities.offcutLedger import OffcutPiece
from entities.offcuts import Offcut
from entities.orders import Order
from entities.products import Product
from entities.variants import Variant

from core.inventory import offcutLedger as ledger
from core.inventory.glassOffcutService import _deduct_sheet_stock, _is_scrap, _upsert_glass_offcut
from core.inventory.poolKey import compute_pool_key

ORDER_ID = 201
SHEET_PIECE = 19352
MARKER = "fix_order_201_shared_sheet"


def pieces_to_credit(db):
    """Read the sheet's layout from the audit record of the edit rather than hard-coding it."""
    h = db.exec(select(EditHistory).where(EditHistory.entity_id == ORDER_ID,
                                         EditHistory.entity_type == "order")).first()
    out = []
    for it in h.before_snapshot["items"]:
        for line in it["details"].get("lineItems") or []:
            for src in line.get("offcut_sources") or []:
                if src.get("source_piece_id") != SHEET_PIECE:
                    continue
                for c in src.get("cuts") or []:
                    out.append((c["width"], c["height"], "cut piece"))
                for r in src.get("remainders_created") or []:
                    out.append((r["width"], r["height"], "remainder"))
    return out


def main():
    apply = "--apply" in sys.argv
    with Session(engine) as db:
        if db.exec(select(EditHistory).where(EditHistory.entity_id == ORDER_ID,
                                            EditHistory.notes.like(f"{MARKER}%"))).first():
            print("Already applied — nothing to do.")
            return

        sheet = db.get(OffcutPiece, SHEET_PIECE)
        product = db.get(Product, sheet.product_id)
        variant = db.get(Variant, sheet.variant_id)
        pool_key = compute_pool_key(db, variant)
        pieces = pieces_to_credit(db)
        total = sum(w * h for w, h, _ in pieces)

        print(f"Order {ORDER_ID}: {product.name.strip()} / {variant.name}  (sheet piece {SHEET_PIECE})")
        print(f"  sheet ledger state now : {sheet.state}  (retired as 'whole sheet returned to stock')")
        print(f"  variant stock now      : {variant.stock_quantity}  -> {variant.stock_quantity - 1}")
        print(f"  pieces to put in the offcut pool ({len(pieces)}):")
        for w, h, kind in pieces:
            print(f"     {w:>6.0f} x {h:<6.0f} {kind}{'  (scrap: under min usable)' if _is_scrap((w, h), variant) else ''}")
        print(f"  area {total:.0f} mm2 vs sheet {sheet.width * sheet.height:.0f} mm2"
              f" -> {'matches' if abs(total - sheet.width * sheet.height) < 1 else 'MISMATCH'}")

        if not apply:
            print("\nDry run — nothing written. Re-run with --apply.")
            return

        _deduct_sheet_stock(db, product, variant, 1)
        for w, h, kind in pieces:
            status = "scrap" if _is_scrap((w, h), variant) else "available"
            _upsert_glass_offcut(db, product, variant, w, h, status, pool_key=pool_key,
                                 parent_piece=sheet, origin=ledger.ORIGIN_CORRECTION,
                                 ledger_notes=f"{MARKER}: {kind} of a sheet wrongly returned whole")
        order = db.get(Order, ORDER_ID)
        db.add(EditHistory(
            entity_type="stock_correction", entity_id=ORDER_ID, edited_by=order.servedby,
            action="edit",
            before_snapshot={"variant_id": variant.variantId, "sheet_piece": SHEET_PIECE,
                             "stock": variant.stock_quantity + 1},
            after_snapshot={"stock": variant.stock_quantity,
                            "pieces_credited": [[w, h, k] for w, h, k in pieces]},
            notes=f"{MARKER}: the edit at 00:19 returned a cut 5mm sheet to stock whole "
                  "(two lines on one sheet answered differently)",
        ))
        db.commit()
        print(f"\nApplied. Variant stock is now {variant.stock_quantity}.")


if __name__ == "__main__":
    main()
