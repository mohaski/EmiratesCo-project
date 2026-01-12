from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict
from sqlmodel import Session
from db.database import get_session
from entities.users import User
from core.userManagement.authService import get_current_user
from . import model, service

router = APIRouter(prefix="/messages", tags=["Messaging"])

# ---------------------------------------------------------------------------
# Messaging Endpoints
# ---------------------------------------------------------------------------

@router.post("/", response_model=dict)
def send_message(
    message_data: model.messageCreate,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    Send a message to one or more users/roles.
    """
    return service.send_message(message_data, current_user, db)

@router.get("/inbox", response_model=List[model.messageResponse])
def get_inbox(
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    Get messages for the current user.
    """
    return service.read_inbox(current_user, db)

@router.put("/{message_id}/read", response_model=dict)
def mark_message_read(
    message_id: int,
    status_data: model.messageReadStatusUpdate,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    Update message read status.
    """
    return service.update_message_read_status(message_id, status_data, current_user, db)
