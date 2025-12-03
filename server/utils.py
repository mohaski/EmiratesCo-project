from fastapi import HTTPException, status, Depends
from .core.userManagement.authService import get_current_user
from .logging import logger

def require_role(allowed_roles: list[str], current_user= Depends(get_current_user)):
    if current_user.role not in allowed_roles:
        logger.warning(f"User {current_user.userId} attempted to access a restricted operation.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation not permitted"
        )
    logger.info(f"User {current_user.userId} authorized for operation.")
    return True
        
