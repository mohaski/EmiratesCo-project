"""Seed emiratesco_edit_test for browser testing: one user per role, a simple
product, a registered customer. Run from server/."""
import sys, os, uuid, logging
sys.path.insert(0, os.getcwd())
logging.disable(logging.CRITICAL)
from sqlmodel import Session, create_engine, select, text
from config import settings
import entities  # noqa: F401
from entities.users import User
from entities.customers import Customer
from entities.products import Category, Product
from entities.variants import Variant
from core.userManagement.authService import hash_password

base, _, _ = settings.get_database_url().rpartition("/")
engine = create_engine(f"{base}/emiratesco_edit_test", echo=False)
PW = "Test1234!"
with Session(engine) as db:
    assert db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test"
    db.exec(text("TRUNCATE open_containers, offcut_piece_events, offcut_pieces, offcuts, payments, credits, orderitems, edit_history, orders, invoices, variants, products, categories, customers, stock_operations, stock_journal, system_settings, attribute_values, attribute_classes, tool_loan_items, tool_loans, tools RESTART IDENTITY CASCADE"))
    db.exec(text("DELETE FROM users WHERE username LIKE 'qa_%'"))
    # Receipt numbers start 1000 above internal order ids, so any screen or message that
    # shows an orderId where people expect the order number is obvious (sale windows).
    db.exec(text("TRUNCATE sale_windows RESTART IDENTITY"))
    db.exec(text("INSERT INTO order_number_counter (id, last_no) VALUES (1, 1000) "
                 "ON CONFLICT (id) DO UPDATE SET last_no = 1000"))
    db.commit()
    for i, role in enumerate(["cashier", "manager", "ceo", "admin"]):
        db.add(User(userId=uuid.uuid4(), firstName="QA", secondName=role.title(), phoneNumber=f"070000010{i}",
                    role=role, email=f"qa_{role}@qa-emiratesco.com", username=f"qa_{role}", password=hash_password(PW),
                    mustChangePassword=False, isActive=True))
    cat = Category(name="QA Accessories", type="hardware", sub_categories=[])
    db.add(cat); db.flush()
    p = Product(name="QA Widget", category_id=cat.categoryId, stock_quantity=500, has_variants=True, unit="pcs", sub_category="general")
    db.add(p); db.flush()
    db.add(Variant(product_id=p.productId, name="", attributes={}, stock_quantity=500, price=100.0))
    # Profile bar: Length label "19.5ft" (the old parser read it as 195), sold full/half/per foot.
    pcat = Category(name="QA Profile", type="qa-profile", sub_categories=[]); db.add(pcat); db.flush()
    bar = Product(name="QA Profile Bar", category_id=pcat.categoryId, stock_quantity=0, has_variants=True, unit="ft",
                  sub_category="general", track_offcuts=False, applicable_attributes=["Color", "Length"])
    db.add(bar); db.flush()
    db.add(Variant(product_id=bar.productId, name="White - 19.5ft", attributes={"Color": "White", "Length": "19.5ft"},
                   stock_quantity=50, price=1950.0, price_half=1000.0, price_unit=100.0, length=19.5))
    # No Color attribute: the old colour filter hid it from Sales.
    bead = Product(name="QA Plain Bead", category_id=pcat.categoryId, stock_quantity=0, has_variants=True, unit="ft",
                   sub_category="general", track_offcuts=False, applicable_attributes=["Length"])
    db.add(bead); db.flush()
    db.add(Variant(product_id=bead.productId, name="21ft", attributes={"Length": "21ft"}, stock_quantity=30, price=500.0, price_unit=30.0, length=21))
    # Offcut-tracked bar: a sale cuts from a new bar and records an offcut_sources event.
    tracked = Product(name="QA Tracked Bar", category_id=pcat.categoryId, stock_quantity=0, has_variants=True, unit="ft",
                      sub_category="general", track_offcuts=True, applicable_attributes=["Color", "Length"])
    db.add(tracked); db.flush()
    db.add(Variant(product_id=tracked.productId, name="White - 21ft", attributes={"Color": "White", "Length": "21ft"},
                   stock_quantity=40, price=2100.0, price_half=1100.0, price_unit=100.0, length=21, min_usable=2.0))
    # Accessory with NO sub-category: the old strict filter hid it from Sales.
    fcat = Category(name="QA Fittings", type="qa-accessories", sub_categories=[]); db.add(fcat); db.flush()
    hinge = Product(name="QA Hinge", category_id=fcat.categoryId, stock_quantity=0, has_variants=True, unit="pcs", sub_category=None)
    db.add(hinge); db.flush()
    db.add(Variant(product_id=hinge.productId, name="", attributes={}, stock_quantity=100, price=50.0))
    # Open-pack product (sold by the piece from opened packs) for Mark Finished / Undo.
    seal = Product(name="QA Sealant", category_id=fcat.categoryId, stock_quantity=5, has_variants=True, unit="pcs",
                   sub_category=None, unit_stock_mode="open_container")
    db.add(seal); db.flush()
    db.add(Variant(product_id=seal.productId, name="", attributes={}, stock_quantity=5, price=500.0, price_unit=60.0, unit_quantity=10))
    # No variants at all: Stock Control must not invent stock for it.
    db.add(Product(name="QA Bare Item", category_id=fcat.categoryId, stock_quantity=0, has_variants=False, unit="pcs", sub_category=None))
    # Glass: 4mm on a big sheet, 6mm on a small one (to re-check pieces on a sheet change).
    gcat = Category(name="QA Glass", type="glass", sub_categories=[]); db.add(gcat); db.flush()
    gl = Product(name="QA Clear Glass", category_id=gcat.categoryId, stock_quantity=0, has_variants=True, unit="sqft",
                 sub_category="general", track_offcuts=False, has_dimensions=True, applicable_attributes=["Thickness"])
    db.add(gl); db.flush()
    db.add(Variant(product_id=gl.productId, name="4mm", attributes={"Thickness": "4mm"}, stock_quantity=20,
                   price=4000.0, price_half=2100.0, price_unit=100.0, length=2440.0, width=1830.0))
    db.add(Variant(product_id=gl.productId, name="6mm", attributes={"Thickness": "6mm"}, stock_quantity=20,
                   price=3000.0, price_half=1600.0, price_unit=120.0, length=1200.0, width=1000.0))
    from entities.attributes import AttributeClass, AttributeValue
    from entities.tools import Tool
    ccls = AttributeClass(name="Color", type="list"); db.add(ccls); db.flush()
    db.add_all([AttributeValue(attribute_class_id=ccls.attributeClassId, value="White"), AttributeValue(attribute_class_id=ccls.attributeClassId, value="Unused Teal")])
    db.add(AttributeClass(name="Unused Finish", type="list"))
    db.add_all([Tool(name="QA Drill", status="available"), Tool(name="QA Grinder", status="available")])
    db.add(Customer(name="QA Customer", phoneNumber="0722222222", type="individual"))
    db.add(Customer(name="QA Business", phoneNumber="0733333334", type="cooperate"))
    db.commit()
    print("seeded; categories:", [(c.categoryId, c.name, c.type) for c in db.exec(select(Category)).all()])
