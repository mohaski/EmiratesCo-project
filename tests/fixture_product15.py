"""Test DB only: the suites written for the live DB hard-code product 15 (no variant).
Reset the catalogue and provide that product so they run here instead of on live data."""
import sys, os, uuid, logging
sys.path.insert(0, os.getcwd()); logging.disable(logging.CRITICAL)
from sqlmodel import Session, create_engine, select, text
from config import settings
import entities  # noqa
from entities.users import User
from entities.customers import Customer
from entities.products import Category, Product
base, _, _ = settings.get_database_url().rpartition("/")
engine = create_engine(f"{base}/emiratesco_edit_test")
with Session(engine) as db:
    assert db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test"
    db.exec(text("TRUNCATE payments, credits, orderitems, edit_history, orders, invoices, offcut_piece_events, offcut_pieces, offcuts, variants, products, categories, customers, stock_operations, stock_journal RESTART IDENTITY CASCADE"))
    db.commit()
    cat = Category(name="Fixture", type="hardware", sub_categories=[]); db.add(cat); db.flush()
    db.add(Product(productId=15, name="Fixture 15", category_id=cat.categoryId, stock_quantity=100000, has_variants=False, unit="pcs"))
    db.add(Customer(name="Emirates", phoneNumber="0700000099", type="individual"))
    if not db.exec(select(User).where(User.role == "manager")).first():
        db.add(User(userId=uuid.uuid4(), firstName="Fix", secondName="Ture", phoneNumber="0700000098", role="manager",
                    email="fixture@qa-emiratesco.com", username="fixture", password="x", mustChangePassword=False, isActive=True))
    db.commit()
    db.exec(text("SELECT setval(pg_get_serial_sequence('products','productId'), 100)")); db.commit()
print("fixture product 15 ready")
