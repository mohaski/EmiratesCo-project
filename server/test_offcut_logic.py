from sqlmodel import Session, create_engine, select
from db.database import DATABASE_URL
from entities.products import Product
from entities.offcuts import Offcut
from entities.orderItems import OrderItem # Simulated
from core.inventory.inventoryService import deduct_stock_for_order_item

# Mock OrderItem
class MockItem:
    def __init__(self, product_id, details, quantity=1):
        self.product_id = product_id
        self.variant_id = None
        self.quantity = quantity
        self.details = details

def test_logic():
    engine = create_engine(DATABASE_URL)
    with Session(engine) as db:
        # 1. Setup Test Product
        p = db.exec(select(Product).where(Product.name == "Test Offcut Bar")).first()
        if not p:
            p = Product(name="Test Offcut Bar", category_id=1, length=10.0, stock_quantity=10, track_offcuts=True, price_full=100.0)
            db.add(p)
            db.commit()
            db.refresh(p)
            print(f"Created Test Product: {p.productId} (Stock: {p.stock_quantity})")
        else:
            # Reset stock
            p.stock_quantity = 10
            db.add(p)
            # Clear offcuts
            db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
            # Delete doesn't work on list in sqlmodel directly like that usually, need loop or delete statement
            # Just loop
            offs = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
            for o in offs: db.delete(o)
            db.commit()
            print(f"Reset Test Product: {p.productId} (Stock: {p.stock_quantity})")

        # 2. Simulate Order for 3ft Cut
        # Should take from Full (10ft) -> Remaining 7ft Offcut
        print("\n--- Test 1: Order 3ft Cut ---")
        item1 = MockItem(p.productId, {"lineItems": [{"type": "accessory-cut", "qty": 1, "meta": {"length": 3.0}}]})
        deduct_stock_for_order_item(db, item1)
        db.commit()
        
        # Check
        db.refresh(p)
        print(f"Stock after 3ft cut: {p.stock_quantity} (Expected 9)")
        offcuts = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
        print(f"Offcuts: {[o.length for o in offcuts]} (Expected [7.0])")
        
        # 3. Simulate Order for 6ft Cut
        # Should NOT fit in 7ft (if we assume best fit? Wait, 6ft DOES fit in 7ft. 7 >= 6)
        # So it should take the 7ft offcut -> Remaining 1ft Offcut
        print("\n--- Test 2: Order 6ft Cut ---")
        item2 = MockItem(p.productId, {"lineItems": [{"type": "accessory-cut", "qty": 1, "meta": {"length": 6.0}}]})
        deduct_stock_for_order_item(db, item2)
        db.commit()
        
        db.refresh(p)
        print(f"Stock after 6ft cut: {p.stock_quantity} (Expected 9 - no change, used offcut)")
        offcuts = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
        print(f"Offcuts: {[o.length for o in offcuts]} (Expected [1.0])")
        
        # 4. Simulate Order for 5ft Cut
        # Should NOT fit in 1ft. Should take Full (10ft) -> Reamining 5ft Offcut.
        print("\n--- Test 3: Order 5ft Cut ---")
        item3 = MockItem(p.productId, {"lineItems": [{"type": "accessory-cut", "qty": 1, "meta": {"length": 5.0}}]})
        deduct_stock_for_order_item(db, item3)
        db.commit()
        
        db.refresh(p)
        print(f"Stock after 5ft cut: {p.stock_quantity} (Expected 8)")
        offcuts = db.exec(select(Offcut).where(Offcut.product_id == p.productId)).all()
        # Should have 1.0 (from before) and 5.0 (new)
        print(f"Offcuts: sorted {[o.length for o in offcuts]} (Expected [1.0, 5.0])")

if __name__ == "__main__":
    try:
        test_logic()
        print("\nTest Complete.")
    except Exception as e:
        print(f"\nTEST FAILED: {e}")
