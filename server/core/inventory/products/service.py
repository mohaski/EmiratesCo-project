from fastapi import Depends, HTTPException, status
from sqlmodel import Session, select
from ....entities.products import Product
from . import models
from ....db.database import get_session
from ...userManagement.authService import get_current_user
from ....app_logging import logger
from ....utils import require_role

def create_product(product_data: models.ProductCreate, db: Session = Depends(get_session), current_user=Depends(get_current_user)
) -> models.ProductCreateResponse:
    """
    Create a new product entry.
    - Only users with admin or manager roles can create products.
    - Validates uniqueness of itemCode and itemName.
    - Returns a structured success message.
    """
    try:
        # 🔐 Ensure user has privilege to create
        require_role(["admin", "CEO"], current_user)

        # 🔁 Check if itemCode or itemName already exists
        duplicate = db.exec(
            select(Product).where(
                (Product.itemCode == product_data.itemCode) &  
                (Product.itemName == product_data.itemName) &
                (Product.color == product_data.color) &
                (Product.fullSizeLength== product_data.fullSizeLength)
                
            )
        ).first()

        if duplicate:
            logger.warning(
                f"Duplicate product detected: {product_data.itemCode} / {product_data.itemName}"
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Product with this code or name already exists"
            )

        # 🧱 Create the new product instance
        new_product = Product(
            itemName=product_data.itemName,
            itemCode=product_data.itemCode,
            versionCategory=product_data.versionCategory,
            useForCategory=product_data.useForCategory,
            productCategory=product_data.productCategory,
            color=product_data.color,
            fullSizeLength=product_data.fullSizeLength,
            priceFull=product_data.priceFull,
            price_per_unit=product_data.price_per_unit,
            price_per_half=product_data.price_per_half,
            trackOffcuts=product_data.trackOffcuts,
            stock=product_data.stock,
            alarm_quantity=product_data.alarm_quantity
        )

        # 💾 Save product
        db.add(new_product)
        db.commit()
        db.refresh(new_product)

        logger.info(f"Product '{new_product.itemName}' created by {current_user.userId}.")

        # ✅ Return a structured response
        return models.ProductCreateResponse(
            message="Product created successfully",
            id=new_product.productId
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating product: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )
    
def update_product( product_id: int, update_data: models.ProductUpdateRequest, db: Session = Depends(get_session), current_user=Depends(get_current_user)
) -> models.ProductUpdateResponse:
    """
    Update a product's details.
    - Only admin or manager roles are allowed.
    - Returns a structured success message.
    """

    try:
        # 🔐 Role-based access control
        require_role(["admin", "CEO"], current_user)

        # 🔍 Check if product exists
        product = db.get(Product, product_id)
        if not product:
            logger.warning(f"Product {product_id} not found.")
            raise HTTPException(status_code=404, detail="Product not found")


        # 🧾 Apply valid update fields only
        for key, value in update_data.dict(exclude_unset=True).items():
            setattr(product, key, value)

        # 💾 Save to database
        db.add(product)
        db.commit()
        db.refresh(product)

        logger.info(f"Product {product_id} updated successfully by {current_user.email}.")

        # ✅ Return a clean structured response
        return models.ProductUpdateResponse(
            message="Product updated successfully",
            id=product.productId
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating product {product_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
def update_stock_quantity(product_id: int, stock_data: models.StockQuantityUpdateRequest, db: Session = Depends(get_session), current_user=Depends(get_current_user)
) -> models.ProductUpdateResponse:
    """
    Update the stock quantity of a product.
    - Only users with admin or manager roles can update stock.
    - Validates that stock is non-negative.
    - Returns a structured success message.
    """
    try:
        # 🔐 Ensure user has privilege to update stock
        require_role(['Admin', 'CEO', 'SeniorCashier'], current_user)

        # 🔍 Check if product exists
        product = db.get(Product, product_id)
        if not product:
            logger.warning(f"Product {product_id} not found for stock update.")
            raise HTTPException(status_code=404, detail="Product not found")

        # 📊 Validate and update stock
        if stock_data.stock < 0:
            logger.warning(f"Negative stock value provided for product {product_id}.")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Stock quantity cannot be negative"
            )

        product.stock = stock_data.stock

        # 💾 Save changes
        db.add(product)
        db.commit()
        db.refresh(product)

        logger.info(f"Stock for product {product_id} updated to {product.stock} by {current_user.email}.")

        # ✅ Return a structured response
        return models.ProductUpdateResponse(
            message="Stock quantity updated successfully",
            id=product.productId
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating stock for product {product_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    

def check_stock_availability(requiredQuantity: int ,product_id: int, db: Session = Depends(get_session)) -> models.StockAvailabilityResponse:
    """
    Check if a product is in stock and return available quantity.
    - Returns whether the product is in stock and the available quantity.
    """
    try:
        # 🔍 Fetch product
        product = db.get(Product, product_id)
        if not product:
            logger.warning(f"Product {product_id} not found for stock check.")
            raise HTTPException(status_code=404, detail="Product not found")
        
        if requiredQuantity > product.stock:
            logger.warning(f'Insufficient stock for product {product_id}: Required={requiredQuantity}, Available={product.stock}')
            return models.StockAvailabilityResponse(
            message= f'There are only {product.stock} of this item remaining '
        )
            
            
        logger.info(f"There is suffiencent amount for the order")

        # ✅ Return structured availability response
        return models.StockAvailabilityResponse(
            message= 'There is suffiencent amount for the order'
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking stock for product {product_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
def getAllProducts(db: Session = Depends(get_session)) -> list[Product]:
    """
    Retrieve all products within a specified product category.
    - Returns a list of products in the given category.
    """
    try:
        # 🔍 Query products by category
        products = db.exec(
            select(Product)).all()

        logger.info(f"Retrieved {len(products)} products.")

        return products
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving products: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
def remove_product(product_id: int, db: Session = Depends(get_session), current_user=Depends(get_current_user)
) -> dict:
    """
    Remove a product from the inventory.
    - Only users with admin or manager roles can delete products.
    - Returns a structured success message.
    """
    try:
        # 🔐 Ensure user has privilege to delete
        require_role(["admin", "CEO"], current_user)

        # 🔍 Check if product exists
        product = db.get(Product, product_id)
        if not product:
            logger.warning(f"Product {product_id} not found for deletion.")
            raise HTTPException(status_code=404, detail="Product not found")

        # 🗑️ Delete the product
        db.delete(product)
        db.commit()

        logger.info(f"Product {product_id} deleted successfully by {current_user.email}.")

        # ✅ Return a structured response
        return {"message": "Product deleted successfully", "id": product_id}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting product {product_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )
        
