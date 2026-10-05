"""Sale windows: a window's private remainders (offcuts.held_by_order_id) are invisible
and unusable to everything except that window (plan T8).

A remainder a window produced exists only on paper - its bar/sheet is still whole on the
rack - so no other sale, correction, listing or Offcut Management action may offer, take,
edit or delete it. Covers the readers written after the original branch too
(cutCorrection.profile_candidates / glass_piece_options).

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
from entities.orders import Order
from entities.products import Category, Product
from entities.saleWindows import SaleWindow
from entities.users import User
from entities.variants import Variant

failures = []


def check(label, ok, got=None):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f" — got {got!r}"))
    if not ok:
        failures.append(label)


with Session(engine) as db:
    assert db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test", "test DB only"

import main  # noqa: E402
from core.userManagement import authService  # noqa: E402
from core.userManagement.model import TokenData  # noqa: E402
from core.inventory import holdScope  # noqa: E402
from core.inventory.cutCorrection import glass_piece_options, profile_candidates  # noqa: E402
from core.inventory.inventoryService import check_line_items_feasible  # noqa: E402

TOKENS, USERS = {}, {}
with Session(engine) as db:
    for role in ("ceo", "manager", "cashier"):
        u = db.exec(select(User).where(User.username == f"qa_{role}")).one()
        USERS[role] = u
        TOKENS[role] = TokenData(userId=str(u.userId), username=u.username, role=role)
current = {"user": TOKENS["ceo"]}
main.app.dependency_overrides[authService.get_current_user] = lambda: current["user"]
client = TestClient(main.app)


def as_(role, method, path, **kw):
    current["user"] = TOKENS[role]
    return client.request(method, path, **kw)


TAG = uuid.uuid4().hex[:5]
with Session(engine) as db:
    cat = db.exec(select(Category)).first()
    bar = Product(name=f"T8 Bar {TAG}", category_id=cat.categoryId, has_variants=True, unit="ft",
                  sub_category="general", track_offcuts=True, stock_quantity=0)
    glass = Product(name=f"T8 Glass {TAG}", category_id=cat.categoryId, has_variants=True, unit="sqft",
                    sub_category="general", track_offcuts=True, has_dimensions=True, stock_quantity=0)
    db.add_all([bar, glass]); db.flush()
    # No whole bars or sheets in stock: the only material is the held remainders below.
    bvar = Variant(product_id=bar.productId, name="21ft", attributes={}, stock_quantity=0, price=2100.0,
                   price_unit=100.0, length=21, min_usable=1.0)
    gvar = Variant(product_id=glass.productId, name="4mm", attributes={}, stock_quantity=0, price=4000.0,
                   price_unit=100.0, length=2440.0, width=1830.0)
    db.add_all([bvar, gvar]); db.flush()

    def window(user):
        o = Order(servedby=user.userId, status="held", payment_status="Unpaid",
                  subtotal=0, total=0, balance=0, amountPayed=0, discount=0)
        db.add(o); db.flush()
        db.add(SaleWindow(order_id=o.orderId, user_id=user.userId, label="Window 1"))
        return o.orderId

    mine = window(USERS["cashier"])      # the cashier's own window (holds nothing)
    theirs = window(USERS["manager"])    # another cashier's window holding the remainders
    from core.inventory.poolKey import compute_pool_key
    bar_row = Offcut(product_id=bar.productId, variant_id=bvar.variantId, pool_key=compute_pool_key(db, bvar),
                     length=10.0, quantity=1, status="available", held_by_order_id=theirs)
    glass_row = Offcut(product_id=glass.productId, variant_id=gvar.variantId, pool_key=compute_pool_key(db, gvar),
                       width=1000.0, height=1000.0, length=0.0, quantity=1, status="available",
                       held_by_order_id=theirs)
    db.add_all([bar_row, glass_row]); db.commit()
    BAR, BVAR, GLASS, GVAR = bar.productId, bvar.variantId, glass.productId, gvar.variantId
    BAR_ROW, GLASS_ROW = bar_row.offcutId, glass_row.offcutId


def rows_unchanged():
    with Session(engine) as db:
        b, g = db.get(Offcut, BAR_ROW), db.get(Offcut, GLASS_ROW)
        return (b.quantity, b.length, b.held_by_order_id, g.quantity, g.width, g.height, g.held_by_order_id)


START = rows_unchanged()
cut_1d = [{"type": "profile-cut", "qty": 1, "meta": {"length": 5}}]
cut_2d = [{"type": "glass-cut", "qty": 1, "meta": {"l": 500, "w": 500, "u": "mm"}}]


def feasible(product_id, variant_id, lines, scope_order=None):
    with Session(engine) as db:
        return check_line_items_feasible(db, db.get(Product, product_id), db.get(Variant, variant_id),
                                         [dict(l) for l in lines], edit_order_id=scope_order)


print("1. Cut engines: only the owning window can draw on its remainders")
check("public bar cut can't use another window's held 10ft", not feasible(BAR, BVAR, cut_1d)["ok"])
check("public glass cut can't use another window's held sheet", not feasible(GLASS, GVAR, cut_2d)["ok"])
check("the cashier's own (other) window can't either", not feasible(BAR, BVAR, cut_1d, mine)["ok"])
check("the owning window CAN cut its own held 10ft", feasible(BAR, BVAR, cut_1d, theirs)["ok"], feasible(BAR, BVAR, cut_1d, theirs))
check("the owning window CAN cut its own held sheet", feasible(GLASS, GVAR, cut_2d, theirs)["ok"], feasible(GLASS, GVAR, cut_2d, theirs))
pick = [dict(cut_1d[0], offcut_selection=[{"offcut_id": BAR_ROW, "length_used": 5}])]
res = feasible(BAR, BVAR, pick)
check("hand-picking another window's held row is refused", not res["ok"] and "held" in (res["message"] or ""), res)

print("2. Listings")
r = as_("cashier", "GET", f"/products/{BAR}/offcuts")
check("offcut picker (no window) leaves it out", r.status_code == 200 and all(o.get("offcutId") != BAR_ROW for o in r.json()), r.text[:150])
r = as_("cashier", "GET", f"/products/{BAR}/offcuts", params={"hold_order_id": mine})
check("picker for the cashier's own window leaves out another window's row",
      r.status_code == 200 and all(o.get("offcutId") != BAR_ROW for o in r.json()), r.text[:150])
r = as_("manager", "GET", f"/products/{BAR}/offcuts", params={"hold_order_id": theirs})
check("picker for the owning window includes it", r.status_code == 200 and any(o.get("offcutId") == BAR_ROW for o in r.json()), r.text[:150])
r = as_("cashier", "GET", f"/products/{BAR}/offcuts", params={"hold_order_id": theirs})
check("asking with someone else's window id is refused (404)", r.status_code == 404, r.status_code)
r = as_("ceo", "GET", "/products/offcuts/all")
ids = {o.get("offcutId") for o in r.json()} if r.status_code == 200 else None
check("Offcut Management list leaves both out", ids is not None and not ids & {BAR_ROW, GLASS_ROW}, (r.status_code, ids and ids & {BAR_ROW, GLASS_ROW}))
r = as_("manager", "POST", f"/products/{GLASS}/glass-cut-preview",
        json={"cuts": [{"l": 500, "w": 500, "u": "mm", "qty": 1}], "variant_id": GVAR})
check("glass preview (no window) doesn't use it", r.status_code == 422 or all(g.get("offcut_id") != GLASS_ROW for g in r.json().get("groups", [])), r.text[:150])
r = as_("manager", "POST", f"/products/{GLASS}/glass-cut-preview",
        json={"cuts": [{"l": 500, "w": 500, "u": "mm", "qty": 1}], "variant_id": GVAR, "hold_order_id": theirs})
check("glass preview for the owning window uses it", r.status_code == 200 and any(g.get("offcut_id") == GLASS_ROW for g in r.json().get("groups", [])), r.text[:200])

print("3. Corrections (written after the branch) don't offer it")
with Session(engine) as db:
    pc = profile_candidates(db, db.get(Product, BAR), db.get(Variant, BVAR), 5.0)
    check("profile correction candidates leave it out", all(o["offcutId"] != BAR_ROW for o in pc["offcuts"]), pc["offcuts"])
    go = glass_piece_options(db, db.get(Product, GLASS), db.get(Variant, GVAR), [{"width": 500, "height": 500}])
    check("glass correction options leave it out", all(o["offcutId"] != GLASS_ROW for o in go["offcuts"]), go["offcuts"])
    with holdScope.holding_for(theirs):
        pc = profile_candidates(db, db.get(Product, BAR), db.get(Variant, BVAR), 5.0)
    check("...but the owning window's scope sees it", any(o["offcutId"] == BAR_ROW for o in pc["offcuts"]), pc["offcuts"])
    db.rollback()

print("4. Offcut Management can't edit or delete it")
r = as_("ceo", "PATCH", f"/products/offcuts/{BAR_ROW}", json={"length": 9.0})
check("edit refused (409)", r.status_code == 409, (r.status_code, r.text[:150]))
r = as_("ceo", "POST", "/products/offcuts/bulk-delete", json={"offcut_ids": [GLASS_ROW]})
check("delete refused (409)", r.status_code == 409, (r.status_code, r.text[:150]))

print("5. Nothing above changed either row")
check("both held rows untouched", rows_unchanged() == START, (START, rows_unchanged()))

print()
print("ALL PASS" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
