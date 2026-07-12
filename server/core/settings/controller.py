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
