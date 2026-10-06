"""Server-side item pricing (orderService._calculate_complex_item_total) - the real function, with
absolute expected totals. The database prices win; the till's rate is used only where the
database has none. Needs no database: product and variant come in through the caches.
Exits 1 on any failure."""
import sys
from decimal import Decimal
from types import SimpleNamespace

from core.ordering import model
from core.ordering.orderService import _calculate_complex_item_total

failures = []


def check(label, got, want):
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f" — got {got!r}, want {want!r}"))
    if not ok:
        failures.append(label)


PRODUCT = SimpleNamespace(productId=1)


def total(lines=None, *, price=0, half=0, unit=0, qty=1.0, unit_price=0.0):
    variant = SimpleNamespace(variantId=1, product_id=1, price=price, price_half=half, price_unit=unit)
    req = model.OrderItemRequest(productId=1, variantId=1, quantity=qty, unitPrice=unit_price, unitType="pcs",
                                 details={"lineItems": lines} if lines is not None else {})
    return _calculate_complex_item_total(req, None, {1: PRODUCT}, {1: variant})


def test():
    print("Full lengths")
    check("DB price wins over the till's rate: 3 x 1500", total([{"type": "profile-full", "qty": 3, "rate": 2000}], price=1500),
          Decimal("4500"))
    check("no DB price: the till's rate, 3 x 2000", total([{"type": "profile-full", "qty": 3, "rate": 2000}], price=0),
          Decimal("6000"))
    print("Halves")
    check("DB half price: 2 x 800", total([{"type": "profile-half", "qty": 2, "rate": 999}], half=800), Decimal("1600"))
    check("no DB half price: the till's rate", total([{"type": "profile-half", "qty": 2, "rate": 700}], half=0),
          Decimal("1400"))
    print("Cuts")
    check("profile cut: 4ft x 120/ft x 2", total([{"type": "profile-cut", "qty": 2, "meta": {"length": 4}, "rate": 1}], unit=120),
          Decimal("960"))
    check("profile cut, no DB foot price: 4ft x the till's 150/ft",
          total([{"type": "profile-cut", "qty": 1, "meta": {"length": 4}, "rate": 150}], unit=0), Decimal("600"))
    check("glass cut: 1.5 sqft x 180 x 2",
          total([{"type": "glass-cut", "qty": 2, "meta": {"area": 1.5}, "rate": 1}], unit=180), Decimal("540.0"))
    print("Other lines and simple items")
    check("accessory pack: the till's rate, 3 x 50", total([{"type": "accessory-unit", "qty": 3, "rate": 50}]),
          Decimal("150"))
    check("several lines add up: 1500 + 960",
          total([{"type": "profile-full", "qty": 1, "rate": 1}, {"type": "profile-cut", "qty": 2, "meta": {"length": 4}}],
                price=1500, unit=120), Decimal("2460"))
    check("simple item: DB price 200 x 2", total(price=200, qty=2.0, unit_price=999.0), Decimal("400"))
    check("simple item, no DB price: the till's unit price 2 x 250", total(price=0, qty=2.0, unit_price=250.0),
          Decimal("500"))


if __name__ == "__main__":
    test()
    print("\nALL PASS" if not failures else f"\n{len(failures)} FAILED: {failures}")
    sys.exit(1 if failures else 0)
