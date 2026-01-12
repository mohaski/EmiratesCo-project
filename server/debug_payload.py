from core.ordering.model import OrderCreate
from uuid import uuid4
import json

# Simulated payload from OrderContext logic
payload = {
    "customerId": 101,
    "amountPaid": 5000.0,
    "servedBy": str(uuid4()), # Valid UUID string
    "VAT_status": True,
    "discount": 0.0,
    "paymentStatus": "Paid",
    "status": "confirmed",
    "paymentMethod": "cash",
    "paymentDetails": None,
    "items": [
        {
            "productId": 1,
            "variantId": None,
            "quantity": 10.0,
            "unitPrice": 500.0,
            "unitType": "pcs",
            "details": {"some": "meta"}
        }
    ]
}

print("--- Testing Valid Payload ---")
try:
    obj = OrderCreate.parse_obj(payload)
    print("SUCCESS: Payload is valid.")
    print(obj)
except Exception as e:
    print(f"ERROR: {e}")

print("\n--- Testing Potential Failure: Empty variantId string ---")
payload_fail_variant = payload.copy()
payload_fail_variant["items"] = [
     {
            "productId": 1,
            "variantId": "", # Frontend might send empty string?
            "quantity": 10.0,
            "unitPrice": 500.0,
            "unitType": "pcs"
    }
]
try:
    OrderCreate.parse_obj(payload_fail_variant)
    print("SUCCESS: Payload is valid.")
except Exception as e:
    print(f"EXPECTED ERROR (VariantId empty string): {e}")

print("\n--- Testing Potential Failure: UUID Validity ---")
payload_fail_uuid = payload.copy()
payload_fail_uuid["servedBy"] = "user-123" # invalid uuid
try:
    OrderCreate.parse_obj(payload_fail_uuid)
    print("SUCCESS")
except Exception as e:
    print(f"EXPECTED ERROR (Invalid UUID): {e}")
