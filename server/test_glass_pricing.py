"""
Glass pricing on the server (orderService._glass_line_rate).

  - A glass cut's area is worked out from its size, exactly as GlassCalculator.jsx getArea()
    does - the browser's meta.area is ignored (a cut sent with area 0.5 was charged for 0.5).
  - A glass line with no price in the database is refused. The browser's own rate used to be
    the fallback, so a half sheet with no half price went free next to a priced full sheet.

Runs against emiratesco_edit_test only (it truncates tables):

    python test_glass_pricing.py
"""
import copy

from fastapi import HTTPException
from sqlmodel import Session, text

import test_order_edit_matrix as M
from _testdb_guard import require_test_db
from core.invoices.service import _price_quotation
from core.ordering import model, orderService

check = M.check
failures = M.failures

# (l, w, unit, sq ft) - each value worked out by client/src/utils/calculations.js itself.
CLIENT_AREAS = [
    (600, 400, "mm", 3), (1000, 1000, "mm", 12.25), (2440, 1830, "mm", 48), (10, 500, "mm", 0),
    (3.04, 2, "ft", 6), (3.05, 2, "ft", 7), (3.52, 2.5, "ft", 8.75), (3.56, 1, "ft", 4),
    (24, 18, "inch", 3), (30.6, 12, "inch", 3), (1220, 915, "mm", 12), (457.2, 304.8, "mm", 2),
]


def main():
    engine = M.engine_for_test_db()
    require_test_db(engine)
    db = Session(engine)
    M.reset(db)
    db.exec(text("TRUNCATE stock_operations, stock_journal RESTART IDENTITY"))
    db.commit()
    cat, user = M.seed_base(db)
    prod, var = M.seed_product(db, cat, "Pricing glass", kind="glass")   # full 100, half 60, 12/sqft
    db.commit()

    def price(*lines):
        req = model.OrderItemRequest(productId=prod.productId, variantId=var.variantId, quantity=1,
                                     unitPrice=0, unitType="pcs", details={"lineItems": list(lines)})
        return orderService._calculate_complex_item_total(req, db)

    def refused(*lines):
        try:
            price(*lines)
        except ValueError as e:
            return str(e)
        return None

    def set_prices(**kw):
        for k, v in kw.items():
            setattr(var, k, v)
        db.add(var)
        db.commit()

    half = {"type": "sheet-half", "qty": 1, "meta": {"halfSide": "width"}, "rate": 0, "total": 0}
    full = {"type": "sheet-full", "qty": 1, "meta": {}, "rate": 0, "total": 0}

    print("\n--- P1. A cut's area is the till's area, worked out on the server ---")
    got = [(l, w, u, orderService.glass_cut_area_sqft({"l": l, "w": w, "u": u})) for l, w, u, _ in CLIENT_AREAS]
    check("server area equals the till's for every case", got, [tuple(c) for c in CLIENT_AREAS])

    print("\n--- P2. The browser's meta.area and rate are ignored ---")
    honest = M.line_cut_2d(1000, 1000)
    lied = copy.deepcopy(honest)
    lied["meta"]["area"], lied["rate"] = 0.5, 1
    check("a 1000x1000mm cut is 12.25 sq ft x 12", price(honest), 147)
    check("the same cut sent with area 0.5 still costs 147", price(lied), 147)
    check("qty 3 of it", price({**honest, "qty": 3}), 441)

    print("\n--- P3. A glass line with no price in the database is refused ---")
    check("full + half, both priced", price(full, half), 160)
    set_prices(price_half=0.0)
    msg = refused(full, half)
    check("a half sheet with no half price is refused, not sold for the till's 0",
          bool(msg) and "half-sheet price" in msg, True)
    set_prices(price_half=60.0, price=0.0)
    check("a full sheet with no price is refused", bool(refused(full)), True)
    set_prices(price=100.0, price_unit=0.0)
    msg = refused(full, M.line_cut_2d(600, 400))
    check("a cut with no price per sq ft is refused", bool(msg) and "per sq ft" in msg, True)
    set_prices(price_unit=12.0)
    msg = refused(M.line_cut_2d(10, 500))
    check("a piece too small to have an area is refused", bool(msg) and "too small" in msg, True)
    check("a cut with no size at all is refused",
          bool(refused({"type": "glass-cut", "qty": 1, "meta": {"area": 9}, "rate": 100})), True)

    print("\n--- P4. Checkout and quotations refuse it with the reason ---")
    set_prices(price_half=0.0)
    stock = M.stock_of(db, var)
    item = model.OrderItemRequest(productId=prod.productId, variantId=var.variantId, quantity=1, unitPrice=0,
                                  unitType="pcs", details={"lineItems": [full, half]})
    try:
        orderService.create_order(model.OrderCreate(customerName="Pricing", servedBy=user.userId, items=[item],
                                                    amountPaid=0, paymentMethod="cash", VAT_status=False),
                                  db, M.FakeUser(user.userId))
        status = None
    except HTTPException as e:
        status, detail = e.status_code, str(e.detail)
    check("checkout refuses with 422 and says why", (status, status and "half-sheet price" in detail), (422, True))
    check("and moves no stock", M.stock_of(db, var), stock)
    try:
        _price_quotation([{"productId": prod.productId, "variantId": var.variantId, "quantity": 1,
                           "totalPrice": 100, "details": {"lineItems": [full, half]}}], False, 0, db)
        status = None
    except HTTPException as e:
        status = e.status_code
    check("a quotation is refused with 422 too", status, 422)

    db.close()
    print("\n" + "=" * 68)
    if failures:
        print(f"{len(failures)} FAILED:")
        for f in failures:
            print(f"  - {f}")
        raise SystemExit(1)
    print("All glass pricing checks passed.")


if __name__ == "__main__":
    main()
