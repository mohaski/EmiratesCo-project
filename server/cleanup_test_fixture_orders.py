"""
Cancel orders that the offcut test suites wrote into the live database.

test_offcut_logic.py and test_glass_offcut_logic.py create real Order rows through whatever
DATABASE_URL points at. Run against the live database they leave orders on the
"Test Offcut Bar" / "Test Glass Sheet" fixtures behind — pending, zero-value, and, for any
with a cut line, sitting in the floor's cutting queue next to real work.

Run the suites against the throwaway database instead:
    DATABASE_URL=postgresql+psycopg2://postgres:<pw>@localhost/emiratesco_edit_test python test_glass_offcut_logic.py

SCOPE — an order is touched only if ALL of these hold:
  - every item is on a product whose name starts with "Test "
  - total and amount paid are both zero, and no payment row exists
  - it is not already cancelled
Anything with a real product, any money, or a payment is left alone and reported.

WHAT IT DOES
Cancels through the application's own path (orderService._restore_and_cancel), so the
fixtures' stock and offcuts are restored exactly as a real cancel would, the ledger is
kept consistent, and each order drops out of the cutting queue. Nothing is deleted: the
rows stay, marked cancelled, with an edit_history entry saying why.

    python cleanup_test_fixture_orders.py            # dry run: list what would be cancelled
    python cleanup_test_fixture_orders.py --apply    # cancel them
"""
import sys

from sqlmodel import Session, select

from db.database import engine

import entities  # noqa: F401 — registers every table on SQLModel.metadata
from entities.editHistory import EditHistory
from entities.orders import Order
from entities.payments import Payment
from entities.products import Product

from core.inventory import reversalPlan as rp
from core.ordering import orderService


def default_answers(plan) -> dict:
    """Accept every prefill. UNKNOWN has none, and 'not cut' lets the chain decide."""
    out = {}
    for line in plan["lines"]:
        state = line["default_physical_state"]
        if state == rp.PHYS_UNKNOWN:
            state = rp.PHYS_NOT_CUT
        out[line["line_ref"]] = {
            "physicalState": state,
            "resolution": rp.RES_RETURN_TO_POOL if state == rp.PHYS_ALREADY_CUT else None,
        }
    return out


def find(db):
    test_pids = {p.productId for p in db.exec(select(Product)).all()
                 if (p.name or "").startswith("Test ")}
    paid_orders = {p.orderId for p in db.exec(select(Payment)).all()}

    fixtures, skipped = [], []
    for order in db.exec(select(Order).where(Order.status != "cancelled")
                         .order_by(Order.orderId)).all():
        pids = {i.product_id for i in order.orderItems}
        if not pids or not pids <= test_pids:
            continue
        if (order.total or 0) != 0 or (order.amountPayed or 0) != 0 or order.orderId in paid_orders:
            skipped.append(order.orderId)
            continue
        fixtures.append(order)
    return fixtures, skipped


def main():
    apply = "--apply" in sys.argv
    with Session(engine) as db:
        fixtures, skipped = find(db)
        in_queue = [o.orderId for o in fixtures if any(not i.cutting_completed for i in o.orderItems)]
        print(f"Test-fixture orders to cancel: {len(fixtures)}  "
              f"({len(in_queue)} currently in the cutting queue)")
        if skipped:
            print(f"Left alone — test products but money attached: {skipped}")
        if fixtures:
            print("  ids:", ", ".join(str(o.orderId) for o in fixtures))
        if not apply:
            print("\nDry run — nothing written. Re-run with --apply to cancel them.")
            return

        done = 0
        for order in fixtures:
            plan = rp.build_plan(db, order)
            decisions = rp.validate_decisions(plan, default_answers(plan))
            orderService._restore_and_cancel(db, order, None, cut_decisions=decisions)
            db.add(EditHistory(
                entity_type="order_cancellation",
                entity_id=order.orderId,
                edited_by=order.servedby,
                action="cancel",
                before_snapshot={"status": "pending"},
                after_snapshot={"status": "cancelled", "amount_refunded": 0.0, "refund_method": None},
                notes="cleanup_test_fixture_orders: fixture written into the live database "
                      "by the offcut test suites",
            ))
            db.commit()
            done += 1
        print(f"\nCancelled {done} test-fixture order(s).")


if __name__ == "__main__":
    main()
