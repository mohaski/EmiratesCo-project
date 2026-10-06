"""Sale windows: a reopened line is never offered a leftover that doesn't exist yet for it.

A window line cutting 9ft from a new 21ft bar holds the bar, and its 12ft leftover is the
window's private remainder. Reopening THAT line used to list the 12ft as an offcut it could
cut from - but it is that very bar: a cart change rebuilds the window line by line in cart
order, the 12ft only reappears once the line is cut again, and a pick of it was silently
dropped on save (the cut came from a new bar while the screen said "from the 12ft offcut").
The same goes for a leftover a LATER line produced. An earlier line's leftover stays offered
(it really exists when this line is rebuilt), and so do public offcuts.

Runs on emiratesco_edit_test (DATABASE_URL), after the seed. Run from server/.
"""
import logging
import os
import sys
import uuid

sys.path.insert(0, os.getcwd())
logging.disable(logging.CRITICAL)

from fastapi.testclient import TestClient
from sqlmodel import Session, select, text

import entities  # noqa: F401
from db.database import engine
from entities.offcuts import Offcut
from entities.products import Category, Product
from entities.users import User
from entities.variants import Variant

with Session(engine) as _db:
    assert _db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test", "test DB only"

import main  # noqa: E402
from core.userManagement import authService  # noqa: E402
from core.userManagement.model import TokenData  # noqa: E402
from core.ordering import windowService, windowModel as wm  # noqa: E402
from core.ordering.model import OrderItemRequest  # noqa: E402
from core.inventory.products.service import get_offcuts_for_product  # noqa: E402

failures = []


def check(label, ok, got=None):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f" — got {got!r}"))
    if not ok:
        failures.append(label)


TOKENS = {}
with Session(engine) as db:
    for role in ("ceo", "cashier", "manager"):
        u = db.exec(select(User).where(User.username == f"qa_{role}")).one()
        TOKENS[role] = TokenData(userId=str(u.userId), username=u.username, role=role)
    windowService.set_windows_enabled(db, True, TOKENS["ceo"])
    cat = db.exec(select(Category)).first()
    bar = Product(name=f"OR Bar {uuid.uuid4().hex[:5]}", category_id=cat.categoryId, has_variants=True, unit="ft",
                  sub_category="general", track_offcuts=True, stock_quantity=0)
    db.add(bar); db.flush()
    var = Variant(product_id=bar.productId, name="21ft", attributes={}, stock_quantity=10, price=2100.0,
                  price_unit=100.0, length=21, min_usable=1.0)
    db.add(var); db.commit()
    PID, VID = bar.productId, var.variantId
CASHIER = TOKENS["cashier"]
current = {"user": CASHIER}
main.app.dependency_overrides[authService.get_current_user] = lambda: current["user"]
client = TestClient(main.app)


def cut(length, pref="new", selection=None):
    line = {"type": "profile-cut", "qty": 1, "meta": {"length": length}, "rate": 100.0, "source_pref": pref}
    if selection:
        line["offcut_selection"] = selection
    return OrderItemRequest(productId=PID, variantId=VID, quantity=1, unitPrice=0, unitType="ft",
                            details={"lineItems": [line]})


def open_window():
    with Session(engine) as db:
        return windowService.open_window(db, CASHIER, wm.WindowOpenRequest(deviceId="t"))


def set_cart(w, items):
    with Session(engine) as db:
        return windowService.set_cart(db, w.windowId, CASHIER, wm.WindowCartRequest(version=w.version, items=items))


def listing(w, item_id=None):
    """(length, quantity) the picker offers - through the real route."""
    params = {"variant_id": VID, "hold_order_id": w.orderId}
    if item_id:
        params["for_item_id"] = item_id
    r = client.get(f"/products/{PID}/offcuts", params=params)
    assert r.status_code == 200, r.text
    return sorted((round(o["length"], 2), o["quantity"]) for o in r.json())


def release(w):
    with Session(engine) as db:
        windowService.release_window(db, w.windowId, CASHIER)


def item_ids(w):
    return [i.itemId for i in w.items]   # cart order


print("1. Reopening the line that cut 9ft from a new 21ft bar")
w = set_cart(open_window(), [cut(9)])
(l1,) = item_ids(w)
check("a new line in the window is offered the 12ft leftover", listing(w) == [(12.0, 1)], listing(w))
check("the line that made it is not", listing(w, l1) == [], listing(w, l1))
with Session(engine) as db:
    offered = get_offcuts_for_product(PID, db, VID, w.orderId, l1)
check("the service agrees (nothing offered)", offered == [], offered)
release(w)

print("2. Two lines: an earlier line's leftover is offered, a later line's is not")
w = set_cart(open_window(), [cut(9), cut(5)])     # leftovers 12ft (line 1) and 16ft (line 2)
l1, l2 = item_ids(w)
check("window holds 12ft and 16ft", listing(w) == [(12.0, 1), (16.0, 1)], listing(w))
check("reopening line 1: neither (16ft is line 2's, made after it)", listing(w, l1) == [], listing(w, l1))
check("reopening line 2: line 1's 12ft only", listing(w, l2) == [(12.0, 1)], listing(w, l2))
release(w)

print("3. Same-size leftovers pooled in one row are told apart")
w = set_cart(open_window(), [cut(9), cut(9)])     # two 12ft leftovers
l1, l2 = item_ids(w)
check("window holds 2 x 12ft", listing(w) == [(12.0, 2)], listing(w))
check("reopening line 2: 1 x 12ft (line 1's)", listing(w, l2) == [(12.0, 1)], listing(w, l2))
check("reopening line 1: none", listing(w, l1) == [], listing(w, l1))
release(w)

print("4. Public offcuts are always offered")
current["user"] = TOKENS["manager"]
r = client.post(f"/products/{PID}/offcuts/bulk", json=[{"variant_id": VID, "length": 12, "quantity": 1}])
current["user"] = CASHIER
check("a public 12ft entered", r.status_code == 200, r.text[:120])
w = set_cart(open_window(), [cut(9)])
(l1,) = item_ids(w)
check("reopened line still sees the public 12ft (and not its own)", listing(w, l1) == [(12.0, 1)], listing(w, l1))
release(w)
with Session(engine) as db:
    for row in db.exec(select(Offcut).where(Offcut.product_id == PID)).all():
        db.delete(row)
    db.commit()

print("5. A later line picking an earlier line's leftover is honoured")
w = set_cart(open_window(), [cut(9)])
held = [o for o in client.get(f"/products/{PID}/offcuts", params={"variant_id": VID, "hold_order_id": w.orderId}).json()]
w = set_cart(w, [cut(9), cut(10, pref=None, selection=[{"offcut_id": held[0]["offcutId"], "length_used": 10}])])
srcs = [s for i in w.items for line in i.details["lineItems"] for s in line.get("offcut_sources") or []]
check("line 2 cut from the 12ft (offcut), leaving 2ft", any(s["source"] == "offcut" and s["offcut_length"] == 12 and s["remainder_created"] == 2 for s in srcs), srcs)
with Session(engine) as db:
    check("one bar taken in all", db.get(Variant, VID).stock_quantity == 9, db.get(Variant, VID).stock_quantity)
release(w)

print("6. The parameter widens nothing")
w = set_cart(open_window(), [cut(9)])
(l1,) = item_ids(w)
r = client.get(f"/products/{PID}/offcuts", params={"variant_id": VID, "for_item_id": l1})
check("without a window: public only (empty), not an error", r.status_code == 200 and r.json() == [], r.text[:120])
current["user"] = TOKENS["manager"]
r = client.get(f"/products/{PID}/offcuts", params={"variant_id": VID, "hold_order_id": w.orderId, "for_item_id": l1})
current["user"] = CASHIER
check("someone else's window -> 404", r.status_code == 404, r.status_code)
check("an id not in the window: listing unchanged", listing(w, 99999999) == [(12.0, 1)], listing(w, 99999999))
release(w)
with Session(engine) as db:
    check("all windows released: every bar back", db.get(Variant, VID).stock_quantity == 10, db.get(Variant, VID).stock_quantity)

print()
print("ALL PASS" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
