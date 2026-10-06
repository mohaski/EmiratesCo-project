"""Group-5 service rules on emiratesco_edit_test. Run from server/."""
import sys, os, uuid, logging
sys.path.insert(0, os.getcwd()); logging.disable(logging.CRITICAL)
from fastapi import HTTPException
from sqlmodel import Session, create_engine, select, text
from config import settings
import entities  # noqa
from entities.users import User
from entities.products import Category, Product
from entities.variants import Variant
from entities.orders import Order
from entities.orderItems import OrderItem
from entities.attributes import AttributeClass, AttributeValue
from entities.tools import Tool
from core.inventory.products import service as psvc, model as pmodel
from core.inventory.attributes import service as asvc, model as amodel
from core.tools import service as tsvc, model as tmodel
from core.ordering import orderService

failures = []
def check(label, got, want):
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    if not ok: failures.append(label)
def raises(label, fn, status, contains=None):
    try:
        fn()
    except HTTPException as e:
        ok = e.status_code == status and (contains is None or contains in str(e.detail))
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}: {e.status_code} {e.detail!r}")
        if not ok: failures.append(label)
        return
    print(f"  [FAIL] {label}: no exception"); failures.append(label)

class U:
    def __init__(self, uid, role="ceo"): self.userId = str(uid); self.role = role; self.username = "qa"

base, _, _ = settings.get_database_url().rpartition("/")
engine = create_engine(f"{base}/emiratesco_edit_test")
with Session(engine) as db:
    assert db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test"
    db.exec(text("TRUNCATE offcut_piece_events, offcut_pieces, offcuts, payments, credits, orderitems, edit_history, orders, invoices, variants, products, categories, attribute_values, attribute_classes, stock_operations, stock_journal, tool_loan_items, tool_loans, tools RESTART IDENTITY CASCADE"))
    db.commit()
    user = db.exec(select(User).where(User.role == "ceo")).first()
    cat = Category(name="G5", type="qa-profile", sub_categories=[]); db.add(cat); db.flush()
    p = Product(name="G5 Bar", category_id=cat.categoryId, has_variants=True, unit="ft", applicable_attributes=["Color", "Length"], stock_quantity=10)
    db.add(p); db.flush()
    v = Variant(product_id=p.productId, name="White - 21ft", attributes={"Color": "White", "Length": "21ft"}, stock_quantity=10, price=2000.0, price_half=1100.0, price_unit=100.0, length=21)
    db.add(v)
    color = AttributeClass(name="Color", type="list"); length = AttributeClass(name="Length", type="custom"); spare = AttributeClass(name="Spare", type="list")
    db.add_all([color, length, spare]); db.flush()
    white = AttributeValue(attribute_class_id=color.attributeClassId, value="White"); red = AttributeValue(attribute_class_id=color.attributeClassId, value="Red")
    db.add_all([white, red])
    db.commit()
    IDS = dict(user=user.userId, product=p.productId, variant=v.variantId, color=color.attributeClassId, length=length.attributeClassId,
               spare=spare.attributeClassId, white=white.attributeValueId, red=red.attributeValueId)
ME = U(IDS["user"])

print("1. Variant updates")
def upd(**kw):
    with Session(engine) as db:
        return psvc.update_variant(IDS["variant"], pmodel.VariantUpdate(**kw), db, ME)
raises("remove more than in stock refused (400, not 500)", lambda: upd(stock_change=-15), 400, "only 10")
check("remove down to exactly 0 works", upd(stock_change=-10).stock_quantity, 0)
check("restock works", upd(stock_change=5).stock_quantity, 5)
raises("negative price refused", lambda: upd(price=-1), 400, "negative")
with Session(engine) as db:
    n_before = db.exec(text("select count(*) from edit_history where entity_type='restock'")).one()[0]
upd(price=2100, stock_change=0)
with Session(engine) as db:
    n_after = db.exec(text("select count(*) from edit_history where entity_type='restock'")).one()[0]
check("price-only save writes no restock row", n_after, n_before)
raises("unknown variant is a 404, not a 500", lambda: psvc.update_variant(99999, pmodel.VariantUpdate(price=1), Session(engine), ME), 404)
with Session(engine) as db:
    db.exec(text(f"update variants set stock_quantity = -3 where \"variantId\" = {IDS['variant']}")); db.commit()
check("an already-negative row can be topped up", upd(stock_change=4).stock_quantity, 1)

print("2. Product updates")
def pupd(**kw):
    with Session(engine) as db:
        return psvc.update_product(IDS["product"], pmodel.ProductUpdateRequest(**kw), db, ME)
raises("blank name refused", lambda: pupd(name="   "), 400, "blank")
check("rename trims", (pupd(name="  G5 Bar  "), Session(engine).get(Product, IDS["product"]).name)[1], "G5 Bar")
pupd(trackOffcuts=False)
with Session(engine) as db:
    db.exec(text(f"update products set unit_stock_mode='open_container' where \"productId\"={IDS['product']}")); db.commit()
raises("turning on offcuts for an open-pack product refused", lambda: pupd(trackOffcuts=True), 400, "open packs")
with Session(engine) as db:
    db.exec(text(f"update products set track_offcuts=true where \"productId\"={IDS['product']}")); db.commit()
check("a product already in that state can still be renamed", (pupd(name="G5 Bar 2"), Session(engine).get(Product, IDS["product"]).name)[1], "G5 Bar 2")
with Session(engine) as db:
    db.exec(text(f"update products set track_offcuts=false, unit_stock_mode='counted' where \"productId\"={IDS['product']}")); db.commit()

print("3. Attributes in use")
S = lambda: Session(engine)
raises("rename used class refused", lambda: asvc.rename_attribute_class(IDS["color"], amodel.AttributeClassRename(name="Colour"), S()), 409, "G5 Bar")
raises("delete used class refused", lambda: asvc.delete_attribute_class(IDS["length"], S()), 409)
raises("rename used value refused", lambda: asvc.rename_attribute_value(IDS["white"], amodel.AttributeValueRename(value="Ivory"), S()), 409)
raises("delete used value refused", lambda: asvc.delete_attribute_value(IDS["white"], S()), 409)
check("rename unused value works", asvc.rename_attribute_value(IDS["red"], amodel.AttributeValueRename(value="Crimson"), S()).value, "Crimson")
check("delete unused value works", asvc.delete_attribute_value(IDS["red"], S())["message"], "Attribute value deleted")
check("rename unused class works", asvc.rename_attribute_class(IDS["spare"], amodel.AttributeClassRename(name="Spare2"), S()).name, "Spare2")
check("delete unused class works", asvc.delete_attribute_class(IDS["spare"], S())["message"], "Attribute class deleted")
check("renaming a used class to its own name is allowed", asvc.rename_attribute_class(IDS["color"], amodel.AttributeClassRename(name="Color"), S()).name, "Color")

print("4. Tools")
with Session(engine) as db:
    t = Tool(name="Drill", status="taken"); db.add(t); db.commit(); db.refresh(t); TID = t.toolId
check("renaming a taken tool works (status echoed back)", tsvc.update_tool(TID, tmodel.ToolUpdate(name="Drill X", status="taken"), S()).name, "Drill X")
raises("stale form marking a taken tool available refused", lambda: tsvc.update_tool(TID, tmodel.ToolUpdate(status="available"), S()), 409)
check("still taken", S().get(Tool, TID).status, "taken")
with Session(engine) as db:
    db.get(Tool, TID).status = "available"; db.commit()
check("available tool can be marked non-functional", tsvc.update_tool(TID, tmodel.ToolUpdate(status="non_functional"), S()).status, "non_functional")
raises("'taken' can't be set by hand", lambda: tsvc.update_tool(TID, tmodel.ToolUpdate(status="taken"), S()), 400)

print("5. Cutting report")
with Session(engine) as db:
    def mk(status):
        o = Order(servedby=IDS["user"], customer_name="Q", subtotal=0, total=0, amountPayed=0, balance=0, status=status, payment_status="Unpaid")
        db.add(o); db.flush()
        items = [OrderItem(order_id=o.orderId, product_id=IDS["product"], variant_id=IDS["variant"], total_price=0, details={"lineItems": []}, cutting_completed=False) for _ in range(2)]
        db.add_all(items); db.flush()
        return o.orderId, [i.item_id for i in items]
    live, live_items = mk("confirmed"); dead, dead_items = mk("cancelled")
    db.commit()
res = orderService.mark_cutting_complete_for_orders_batch([live, dead], S(), U(IDS["user"], "manager"), item_ids=[live_items[0], dead_items[0]])
check("only the shown item of the live order marked", sorted(res["updated_items"]), [live_items[0]])
with Session(engine) as db:
    check("the item added later stays pending", db.get(OrderItem, live_items[1]).cutting_completed, False)
    check("cancelled order untouched", db.get(OrderItem, dead_items[0]).cutting_completed, False)
res = orderService.mark_cutting_complete_batch([live_items[1], dead_items[1]], S(), U(IDS["user"], "manager"))
check("item-level report skips the cancelled order", res["updated"], [live_items[1]])
_, more = None, None
with Session(engine) as db:
    o = Order(servedby=IDS["user"], customer_name="Q", subtotal=0, total=0, amountPayed=0, balance=0, status="confirmed", payment_status="Unpaid"); db.add(o); db.flush()
    db.add_all([OrderItem(order_id=o.orderId, product_id=IDS["product"], variant_id=IDS["variant"], total_price=0, details={}, cutting_completed=False) for _ in range(2)]); db.commit()
    old_client = o.orderId
res = orderService.mark_cutting_complete_for_orders_batch([old_client], S(), U(IDS["user"], "manager"))
check("older client (no item ids) still marks every pending item", len(res["updated_items"]), 2)

print("6. Correction fingerprint")
event = {"source_kind": "offcut", "source_id": 7, "cuts": [3.0, 2.5], "length_used": 5.5, "offcut_length": 6.0}
with Session(engine) as db:
    o = Order(servedby=IDS["user"], customer_name="Q", subtotal=0, total=0, amountPayed=0, balance=0, status="confirmed", payment_status="Unpaid"); db.add(o); db.flush()
    it = OrderItem(order_id=o.orderId, product_id=IDS["product"], variant_id=IDS["variant"], total_price=0, cutting_completed=False,
                   details={"lineItems": [{"type": "profile-cut", "offcut_sources": [event]}]}); db.add(it); db.commit()
    OID, IID = o.orderId, it.item_id
def target(exp):
    """One correction request's lookup, then its transaction ends - as in the app. The lookup
    locks the item's stock rows (the global lock order), so a session left open would hold
    them and the next lookup would wait on it forever."""
    with Session(engine) as s:
        try:
            return orderService._correction_target(OID, IID, 0, 0, s, U(IDS["user"], "manager"), expected_event=exp)[0].item_id
        finally:
            s.rollback()
check("matching event accepted", target(dict(event)), IID)
check("same event after a browser round trip (3.0 -> 3) accepted", target({**event, "cuts": [3, 2.5], "offcut_length": 6}), IID)
raises("a different event at that position refused", lambda: target({**event, "source_id": 8}), 409, "changed since you opened it")
check("no fingerprint (older client) still accepted", target(None), IID)

print()
print("ALL PASS" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
