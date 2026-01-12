from decimal import Decimal

# Mock Objects
class MockProduct:
    def __init__(self, price_full=0, price_half=0, price_unit=0):
        self.price_full = price_full
        self.price_half = price_half
        self.price_unit = price_unit

class MockVariant:
    def __init__(self, price=0, price_unit=0):
        self.price = price
        self.price_unit = price_unit

# Extract Logic to test (Simplified version of what I wrote in orderService)
def calculate_logic(product, line_item):
    l_type = line_item.get("type", "")
    qty = Decimal(line_item.get("qty", 0))
    rate = Decimal("0.00")
    
    if "full" in l_type:
        rate = Decimal(product.price_full)
        if rate == 0:
            rate = Decimal(line_item.get("rate", 0))
            print(f"Fallback triggered! Rate: {rate}")
    
    return qty * rate

def test():
    # Scenario: DB Price is 0, Frontend sends 2000
    p = MockProduct(price_full=0)
    line = {"type": "profile-full", "qty": 3, "rate": 2000}
    
    total = calculate_logic(p, line)
    print(f"Test 1 (Fallback): Expected 6000, Got {total}")
    
    if total == 6000:
        print("PASS")
    else:
        print("FAIL")

    # Scenario: DB Price is 1500, Frontend sends 2000 (Should use DB)
    p2 = MockProduct(price_full=1500)
    line2 = {"type": "profile-full", "qty": 3, "rate": 2000}
    
    total2 = calculate_logic(p2, line2)
    print(f"Test 2 (DB Priority): Expected 4500, Got {total2}")

    if total2 == 4500:
        print("PASS")
    else:
        print("FAIL")

if __name__ == "__main__":
    test()
