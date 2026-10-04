from fastapi import APIRouter, Depends, HTTPException, Request, status
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
    request: Request,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Session = Depends(get_session)
):
    """
    Login endpoint to get JWT token. Repeated wrong passwords are slowed down (429).
    """
    return authService.login_for_access_token(form_data, db, client_ip=request.client.host if request.client else None)

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
    # An admin adds staff; only the CEO can create another admin or CEO account.
    if register_request.role in userService.PRIVILEGED_ROLES and current_user.role != "ceo":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Only the CEO can create admin or CEO accounts.")
    return authService.userRegistration(register_request, db)

@router.get("/me", response_model=model.TokenData)
def read_users_me(
    current_user: model.TokenData = Depends(authService.get_current_user_allow_pending)
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
    db: Session = Depends(get_session),
    current_user = Depends(authService.get_current_user)
):
    """
    Get all customers (names and phone numbers — signed-in staff only).
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
    current_user = Depends(authService.get_current_user_allow_pending)
):
    """
    Get user by ID: your own record (the app loads it at sign-in, also while a password
    change is pending), or anyone's for a manager and above.
    """
    from utils import require_role
    if current_user.userId != user_id:
        if current_user.mustChangePassword:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=authService.PASSWORD_CHANGE_REQUIRED)
        require_role(["ceo", "admin", "manager"], current_user)
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
    return userService.delete_user(user_id, db, actor=current_user)

@router.post("/{user_id}/password-reset")
def reset_password(
    user_id: str,
    password_data: model.passwordResetRequest,
    db: Session = Depends(get_session),
    current_user = Depends(authService.get_current_user_allow_pending)
):
    """
    Reset user password. User can reset their own; CEO/admin can reset any.
    """
    from utils import require_role
    if current_user.userId != user_id:
        if current_user.mustChangePassword:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=authService.PASSWORD_CHANGE_REQUIRED)
        require_role(["ceo", "admin"], current_user)
        target = userService.get_user_by_id(user_id, db)
        userService.assert_may_manage(current_user, target, db)
    return userService.password_reset(user_id, password_data, db)

@router.post("/{user_id}/change-password")
def change_password(
    user_id: str,
    password_data: model.passwordChangeRequest,
    db: Session = Depends(get_session),
    current_user = Depends(authService.get_current_user_allow_pending)
):
    """
    Change own password. Must be authenticated as the same user.
    """
    if current_user.userId != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change another user's password")
    return userService.password_change(user_id, password_data, db)

@router.post("/{user_id}/admin-reset-password")
def admin_reset_password(
    user_id: str,
    password_data: model.AdminPasswordResetRequest,
    db: Session = Depends(get_session),
    current_user = Depends(authService.get_current_user)
):
    """
    CEO/admin reset of a user's forgotten password. Requires CEO or admin role.
    """
    from utils import require_role
    require_role(["ceo", "admin"], current_user)
    if user_id == current_user.userId:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Use Change Password in Settings for your own account.")
    return userService.admin_reset_password(user_id, password_data.newPassword, db, actor=current_user)

@router.put("/{user_id}/role")
def change_role(
    user_id: str,
    role_data: model.RoleChangeRequest,
    db: Session = Depends(get_session),
    current_user = Depends(authService.get_current_user)
):
    """
    Change a user's role. Requires CEO or admin role.
    """
    from utils import require_role
    require_role(["ceo", "admin"], current_user)
    return userService.update_role(user_id, role_data.role, db)

@router.put("/{user_id}/status")
def change_status(
    user_id: str,
    status_data: model.StatusChangeRequest,
    db: Session = Depends(get_session),
    current_user = Depends(authService.get_current_user)
):
    """
    Activate or deactivate a user. Requires CEO or admin role.
    """
    from utils import require_role
    require_role(["ceo", "admin"], current_user)
    return userService.set_active_status(user_id, status_data.isActive, current_user, db)


