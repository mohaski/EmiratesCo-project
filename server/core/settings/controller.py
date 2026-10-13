from fastapi import APIRouter, Depends
from sqlmodel import Session
from db.database import get_session
from core.userManagement.authService import get_current_user
from utils import require_role
from . import model, service

router = APIRouter(prefix="/settings", tags=["Settings"])


@router.put("/cancel-pin", response_model=model.MessageResponse)
def set_cancel_pin(
    body: model.CancelPinSet,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    """CEO/admin-only: set or replace the 4-digit PIN required to cancel an order."""
    require_role(["ceo", "admin"], current_user)
    if service.cancel_pin_is_configured(db):
        from uuid import UUID
        from fastapi import HTTPException
        from entities.users import User
        from core.userManagement.authService import verify_password
        from core.userManagement.throttle import login_throttle
        key = f"pin-change|{current_user.userId}"
        login_throttle.check(key)
        actor = db.get(User, UUID(current_user.userId))
        if not body.currentPassword or not actor or not verify_password(body.currentPassword, actor.password):
            login_throttle.failed(key)
            raise HTTPException(status_code=403, detail="Enter your account password to change the PIN.")
        login_throttle.succeeded(key)
    service.set_cancel_pin(db, body.pin, current_user)
    return model.MessageResponse(message="Cancel PIN updated.")


@router.get("/cancel-pin/status", response_model=model.CancelPinStatusResponse)
def get_cancel_pin_status(
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    """Whether a cancel PIN has been configured yet. Never returns the PIN itself."""
    require_role(["ceo", "admin", "manager", "cashier"], current_user)
    return model.CancelPinStatusResponse(configured=service.cancel_pin_is_configured(db))


@router.get("/glass-print", response_model=model.GlassPrintSetting)
def get_glass_print_setting(
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    """Read by every till's receipt page to decide where the glass worksheet prints."""
    require_role(["ceo", "admin", "manager", "cashier"], current_user)
    return model.GlassPrintSetting(a4MinPanels=service.get_glass_a4_min_panels(db))


@router.put("/glass-print", response_model=model.GlassPrintSetting)
def set_glass_print_setting(
    body: model.GlassPrintSetting,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    """CEO/admin-only: how many panels send a glass worksheet to the A4 printer (0 = never)."""
    require_role(["ceo", "admin"], current_user)
    return model.GlassPrintSetting(a4MinPanels=service.set_glass_a4_min_panels(db, body.a4MinPanels, current_user))
