"""Group-7 server rules on emiratesco_edit_test. Run from server/."""
import sys, os, uuid, logging
sys.path.insert(0, os.getcwd()); logging.disable(logging.CRITICAL)
from fastapi import HTTPException
from pydantic import ValidationError
from sqlmodel import Session, create_engine, select, text
from config import settings
import entities  # noqa
from entities.users import User
from entities.products import Category, Product
from entities.orders import Order
from core.inventory.products import service as psvc, model as pmodel
from core.userManagement import authService, model as umodel
from core.ordering import orderService

failures = []
def check(label, got, want):
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    if not ok: failures.append(label)
def raises(label, fn, status=None, exc=HTTPException, contains=None):
    try:
        fn()
    except exc as e:
        code = getattr(e, "status_code", None)
        ok = (status is None or code == status) and (contains is None or contains in str(getattr(e, "detail", e)))
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}: {code} {str(getattr(e, 'detail', e))[:110]!r}")
        if not ok: failures.append(label)
        return
    print(f"  [FAIL] {label}: no exception"); failures.append(label)

base, _, _ = settings.get_database_url().rpartition("/")
engine = create_engine(f"{base}/emiratesco_edit_test")
S = lambda: Session(engine)
with S() as db:
    assert db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test"
    used = Category(name="G7 Used", type="g7-used", sub_categories=[{"id": "busy", "label": "Busy"}, {"id": "idle", "label": "Idle"}])
    empty = Category(name="G7 Empty " + uuid.uuid4().hex[:4], type="g7-empty-" + uuid.uuid4().hex[:4], sub_categories=[])
    db.add_all([used, empty]); db.flush()
    db.add(Product(name="G7 Thing", category_id=used.categoryId, sub_category="busy", has_variants=True, unit="pcs"))
    db.commit()
    USED, EMPTY = used.categoryId, empty.categoryId

print("1. Category / sub-category delete")
raises("deleting a category with products refused", lambda: psvc.delete_category(USED, S()), 409, contains="G7 Thing")
raises("deleting a used sub-category refused", lambda: psvc.remove_subcategory(USED, "busy", S()), 409)
check("unused sub-category removed", [s["id"] for s in psvc.remove_subcategory(USED, "idle", S()).sub_categories], ["busy"])
raises("unknown sub-category is a 404", lambda: psvc.remove_subcategory(USED, "nope", S()), 404)
check("empty category deleted", psvc.delete_category(EMPTY, S())["message"], "Category deleted")
raises("unknown category is a 404", lambda: psvc.delete_category(EMPTY, S()), 404)

print("2. Variant creation refuses negatives")
raises("negative stock", lambda: pmodel.VariantCreate(stock_quantity=-5), exc=ValidationError)
raises("negative price", lambda: pmodel.VariantCreate(price=-1), exc=ValidationError)
raises("negative half price", lambda: pmodel.VariantCreate(price_half=-1), exc=ValidationError)
check("zero and positive values still fine", pmodel.VariantCreate(stock_quantity=0, price=0, price_unit=5).price_unit, 5)

print("3. New accounts get a random temporary password")
u = "g7_" + uuid.uuid4().hex[:6]
with S() as db:
    res = authService.userRegistration(umodel.UserRegistrationRequest(firstName="G", secondName="Seven", username=u, role="cashier",
                                       email=f"{u}@qa-emiratesco.com", phoneNumber="07" + str(uuid.uuid4().int)[:8]), db)
temp = res["temporaryPassword"]
check("a 10-character temporary password is returned", isinstance(temp, str) and len(temp) == 10, True)
check("it is not 1234", temp != "1234", True)
with S() as db:
    user = db.exec(select(User).where(User.username == u)).first()
    check("it works for sign-in", authService.verify_password(temp, user.password), True)
    check("1234 does not", authService.verify_password("1234", user.password), False)
    check("must change it at first sign-in", user.mustChangePassword, True)
u2 = "g7_" + uuid.uuid4().hex[:6]
with S() as db:
    res2 = authService.userRegistration(umodel.UserRegistrationRequest(firstName="G", secondName="Seven", username=u2, role="cashier",
                                        email=f"{u2}@qa-emiratesco.com", phoneNumber="07" + str(uuid.uuid4().int)[:8], password="Chosen123"), db)
check("an explicit password is used and not echoed", res2["temporaryPassword"], None)

print("4. Order search by customer name reaches every order")
tag = uuid.uuid4().hex[:5]
with S() as db:
    me = db.exec(select(User)).first()
    for i in range(3):
        db.add(Order(servedby=me.userId, customer_name=f"Zebra{tag} Builders {i}", subtotal=0, total=0, amountPayed=0, balance=0, status="confirmed", payment_status="Unpaid"))
    db.commit()
with S() as db:
    hits = orderService.get_all_orders(db, 0, 100, search=f"zebra{tag}")
check("case-insensitive name search finds all three", sorted(o.customerName for o in hits), [f"Zebra{tag} Builders {i}" for i in range(3)])
with S() as db:
    check("no search still returns the newest page", len(orderService.get_all_orders(db, 0, 2)), 2)

print("5. Page loads of app routes get the app, API calls get JSON")
from fastapi.testclient import TestClient
import main
client = TestClient(main.app)
r = client.get("/orders/review", headers={"Accept": "text/html,application/xhtml+xml"})
check("browser load of /orders/review -> app HTML", (r.status_code, "text/html" in r.headers.get("content-type", "")), (200, True))
r = client.get("/users", headers={"Accept": "text/html"})
check("browser load of /users -> app HTML", "text/html" in r.headers.get("content-type", ""), True)
r = client.get("/orders/", headers={"Accept": "application/json, text/plain, */*"})
check("API call to /orders/ still the API (401 without a token)", r.status_code, 401)
r = client.get("/docs", headers={"Accept": "text/html"})
check("/docs untouched", r.status_code, 200)

print()
print("ALL PASS" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
