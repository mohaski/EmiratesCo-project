from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Annotated
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session
from db.database import get_session
from entities.users import User
from . import model, authService, userService, customerService

router = APIRouter(prefix="/users", tags=["User Management"])

# ---------------------------------------------------------------------------
# Auth Endpoints
# ---------------------------------------------------------------------------

@router.post("/token", response_model=model.Token)
def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Session = Depends(get_session)
):
    """
    Login endpoint to get JWT token.
    """
    return authService.login_for_access_token(form_data, db)

@router.post("/register")
def register(
    register_request: model.UserRegistrationRequest,
    db: Session = Depends(get_session),
    current_user = Depends(authService.get_current_user)
):
    """
    Register a new user. Requires CEO or admin role.
    """
    from utils import require_role
    require_role(["ceo", "admin"], current_user)
    return authService.userRegistration(register_request, db)

@router.get("/me", response_model=model.TokenData)
def read_users_me(
    current_user: model.TokenData = Depends(authService.get_current_user)
):
    """
    Get current logged-in user info.
    """
    return current_user

# ---------------------------------------------------------------------------
# Customer Endpoints (Placed before dynamic user routes to avoid conflict)
# ---------------------------------------------------------------------------

@router.post("/customers", response_model=model.CustomerCreateResponse)
def create_customer(
    customer_data: model.CustomerCreateRequest,
    db: Session = Depends(get_session),
    current_user = Depends(authService.get_current_user)
):
    """
    Create a new customer.
    """
    return customerService.create_customerAccount(customer_data, db, current_user)

@router.get("/customers", response_model=List[model.CustomerResponse])
def get_customers(
    db: Session = Depends(get_session)
):
    """
    Get all customers.
    """
    return customerService.get_all_customers(db)


# ---------------------------------------------------------------------------
# User Management Endpoints
# ---------------------------------------------------------------------------

@router.get("/", response_model=List[model.userDetailsResponse])
def get_all_users(
    db: Session = Depends(get_session),
    current_user = Depends(authService.get_current_user)
):
    """
    Get all users. Requires authentication.
    """
    from utils import require_role
    require_role(["ceo", "admin", "manager"], current_user)
    return userService.get_users(db)

@router.get("/{user_id}", response_model=model.userDetailsResponse)
def get_user(
    user_id: str,
    db: Session = Depends(get_session),
    current_user = Depends(authService.get_current_user)
):
    """
    Get user by ID. Requires authentication.
    """
    return userService.get_user_by_id(user_id, db)

@router.delete("/{user_id}")
def delete_user(
    user_id: str,
    db: Session = Depends(get_session),
    current_user = Depends(authService.get_current_user)
):
    """
    Delete user by ID. Requires CEO or admin role.
    """
    from utils import require_role
    require_role(["ceo", "admin"], current_user)
    return userService.delete_user(user_id, db)

@router.post("/{user_id}/password-reset")
def reset_password(
    user_id: str,
    password_data: model.passwordResetRequest,
    db: Session = Depends(get_session),
    current_user = Depends(authService.get_current_user)
):
    """
    Reset user password. User can reset their own; CEO/admin can reset any.
    """
    from utils import require_role
    if current_user.userId != user_id:
        require_role(["ceo", "admin"], current_user)
    return userService.password_reset(user_id, password_data, db)

@router.post("/{user_id}/change-password")
def change_password(
    user_id: str,
    password_data: model.passwordChangeRequest,
    db: Session = Depends(get_session),
    current_user = Depends(authService.get_current_user)
):
    """
    Change own password. Must be authenticated as the same user.
    """
    if current_user.userId != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change another user's password")
    return userService.password_change(user_id, password_data, db)



