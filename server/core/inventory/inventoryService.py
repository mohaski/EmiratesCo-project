from sqlmodel import Session, select
from typing import List, Optional
from entities.products import Product
from entities.variants import Variant
from entities.offcuts import Offcut
from entities.orderItems import OrderItem

def deduct_stock_for_order_item(db: Session, item: OrderItem):
    """
    Deduct stock based on Order Item details.
    Handles:
    - Standard Items (Simple Qty deduction)
    - Offcut Items (Full/Half/Cut logic)
    """
    # 1. Identify Product/Variant
    product = db.get(Product, item.product_id)
    if not product:
        raise ValueError(f"Product {item.product_id} not found")

    variant = None
    if item.variant_id:
        variant = db.get(Variant, item.variant_id)

    # 2. Check for Complex Line Items (Offcut Logic)
    details = item.details or {}
    line_items = details.get("lineItems")
    
    # Determine if we are tracking offcuts for this Deduction
    # (Frontend sends breakdown, so we follow that)
    track_offcuts = product.track_offcuts 
    # Or just rely on lineItems presence? 
    # If line_items exist, we process them.
    
    if line_items and isinstance(line_items, list):
        for line in line_items:
            l_type = line.get("type", "")
            qty = int(line.get("qty", 0))
            if qty <= 0: continue
            
            if "full" in l_type:
                # Deduct Full Lengths
                _deduct_full_stock(db, product, variant, qty)
                
            elif "half" in l_type:
                # Deduct Half Lengths (Try finding 0.5 offcut first, else split full)
                full_len = _get_full_length(product, variant)
                half_len = full_len / 2.0
                _process_cut(db, product, variant, half_len, qty, full_len)
                
            elif "cut" in l_type:
                # Deduct Custom Cuts
                meta = line.get("meta", {})
                length = float(meta.get("length", 0))
                if length > 0:
                    full_len = _get_full_length(product, variant)
                    _process_cut(db, product, variant, length, qty, full_len)
                    
            elif "meter" in l_type or "roll" in l_type:
                 # Legacy Meter/Roll logic
                 # If meter, qty is usually length? Frontend sends qty=length for meter?
                 # check AccessoryCalculator: 
                 # lineItems.push({ type: 'accessory-meter', label: 'Meter Length', qty: length ... })
                 # So qty here IS the length to deduct if 'meter'.
                 if "meter" in l_type:
                     # Deduct meters from stock?
                     # If stock is in meters, just subtract.
                     # If stock is simple quantity (units)? 
                     # Usually accessories are stock: int (units) OR float (meters).
                     # Let's assume direct deduction for now.
                     _deduct_simple_stock(db, product, variant, qty) # item.qty is length
                 else:
                     _deduct_simple_stock(db, product, variant, qty)

    else:
        # Simple Deduction
        simple_qty = float(item.details.get("quantity", 0))
        _deduct_simple_stock(db, product, variant, simple_qty)


def _get_full_length(product: Product, variant: Variant = None) -> float:
    if variant and variant.length:
        return float(variant.length)
    if product.length:
        return float(product.length)
    return 0.0

def _deduct_full_stock(db: Session, product: Product, variant: Variant, qty: int):
    if variant:
        if variant.stock_quantity < qty:
             raise ValueError(f"Insufficient stock for {variant.name or product.name}")
        variant.stock_quantity -= qty
        db.add(variant)
    else:
        if product.stock_quantity < qty:
             raise ValueError(f"Insufficient stock for {product.name}")
        product.stock_quantity -= qty
        db.add(product)

def _deduct_simple_stock(db: Session, product: Product, variant: Variant, qty: float):
    if variant:
        variant.stock_quantity -= qty
        db.add(variant)
    else:
        product.stock_quantity -= qty # Usually int, but for meters could be float
        db.add(product)

def _process_cut(db: Session, product: Product, variant: Variant, required_length: float, qty_cuts: int, full_length: float):
    """
    Best-Fit Algorithm for Cuts.
    """
    # For each cut needed
    for _ in range(qty_cuts):
        # 1. Search for Best Fit Offcut
        # Find offcuts >= required_length, ordered by length ASC (smallest waste)
        stmt = select(Offcut).where(
            Offcut.product_id == product.productId,
            Offcut.length >= required_length,
            Offcut.quantity > 0
        ).order_by(Offcut.length.asc())
        
        if variant:
            stmt = stmt.where(Offcut.variant_id == variant.variantId)
        else:
            stmt = stmt.where(Offcut.variant_id == None)
            
        params = db.exec(stmt).all()
        
        offcut_found = params[0] if params else None
        
        if offcut_found:
            # Use Offcut
            offcut_found.quantity -= 1
            remainder = offcut_found.length - required_length
            
            # Clean up empty offcut row if needed, or leave as 0?
            if offcut_found.quantity == 0:
                db.delete(offcut_found)
            else:
                db.add(offcut_found)
                
            # Create new Offcut for remainder if significant
            if remainder > 0.01: # Tolerance
                _create_offcut(db, product, variant, remainder)
                
        else:
            # Consume Full Stock
            if full_length <= 0:
                 # If no length defined, we can't do offcut logic properly.
                 # Fallback: Just deduct 1 stock and assume rest is lost?
                 # Or Error?
                 # Let's deduct 1 full stock.
                 _deduct_full_stock(db, product, variant, 1)
                 # No remainder created because we don't know the full length.
            else:
                if required_length > full_length:
                    raise ValueError(f"Cut length {required_length} exceeds full length {full_length}")
                
                _deduct_full_stock(db, product, variant, 1)
                remainder = full_length - required_length
                if remainder > 0.01:
                    _create_offcut(db, product, variant, remainder)

def _create_offcut(db: Session, product: Product, variant: Variant, length: float):
    # Check if offcut of exactly this length exists to merge?
    stmt = select(Offcut).where(
        Offcut.product_id == product.productId,
        Offcut.length >= length - 0.001, # Float tolerance
        Offcut.length <= length + 0.001
    )
    if variant:
        stmt = stmt.where(Offcut.variant_id == variant.variantId)
    else:
         stmt = stmt.where(Offcut.variant_id == None)
         
    existing = db.exec(stmt).first()
    
    if existing:
        existing.quantity += 1
        db.add(existing)
    else:
        new_offcut = Offcut(
            product_id=product.productId,
            variant_id=variant.variantId if variant else None,
            length=length,
            quantity=1
        )
        db.add(new_offcut)
