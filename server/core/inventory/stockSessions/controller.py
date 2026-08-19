from fastapi import APIRouter, Depends, BackgroundTasks
from sqlmodel import Session
from typing import List

from db.database import get_session
from core.userManagement.authService import get_current_user
from ws.manager import manager
from utils import require_role
from . import model, service

router = APIRouter(prefix="/stock-sessions", tags=["Stock Input Sessions"])


@router.post("/", response_model=model.StockInputSessionResponse)
async def finalize_stock_input_session(
    payload: model.StockInputSessionCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    result = service.finalize_stock_input_session(payload, db, current_user)
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result


@router.get("/", response_model=List[model.StockInputSessionSummary])
def list_stock_input_sessions(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    require_role(["ceo", "manager"], current_user)
    return service.list_stock_input_sessions(db, skip, limit)


@router.get("/{session_id}", response_model=model.StockInputSessionResponse)
def get_stock_input_session(
    session_id: int,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    require_role(["ceo", "manager"], current_user)
    return service.get_stock_input_session(session_id, db)


@router.patch("/{session_id}/items/{item_id}", response_model=model.StockInputSessionItemResponse)
async def correct_stock_input_session_item(
    session_id: int,
    item_id: int,
    payload: model.StockInputItemCorrection,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    result = service.correct_stock_input_session_item(session_id, item_id, payload, db, current_user)
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result
