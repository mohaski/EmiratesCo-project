from sqlmodel import Session, create_engine, select
from db.database import DATABASE_URL
from entities.products import Product
from entities.variants import Variant
from entities.offcuts import Offcut

def check_prices():
    engine = create_engine(DATABASE_URL)
    with Session(engine) as db:
        for pid in [15, 8]:
            p = db.get(Product, pid)
            if p:
                print(f"Product {pid} ({p.name}): PriceFull={p.price_full}, PriceUnit={p.price_unit}, PriceHalf={p.price_half}")
            else:
                print(f"Product {pid} NOT FOUND")

if __name__ == "__main__":
    check_prices()
