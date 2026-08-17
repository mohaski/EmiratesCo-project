from decimal import Decimal, ROUND_CEILING
from fastapi import HTTPException, status, Depends
from core.userManagement.authService import get_current_user
from loggiing import logger

def ceil_amount(value) -> Decimal:
    """Round a monetary amount UP to the nearest whole currency unit — the
    business deals in whole KSH, not cents, so no amount should ever be
    stored or returned with a fractional part."""
    return Decimal(str(value)).to_integral_value(rounding=ROUND_CEILING)

def require_role(allowed_roles: list[str], current_user= Depends(get_current_user)):
    if current_user.role not in allowed_roles:
        logger.warning(f"User {current_user.userId} attempted to access a restricted operation.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation not permitted"
        )
    logger.info(f"User {current_user.userId} authorized for operation.")
    return True
        
