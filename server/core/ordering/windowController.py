from fastapi import APIRouter, Depends, BackgroundTasks
from typing import List
from sqlmodel import Session

from db.database import get_session
from core.userManagement.authService import get_current_user
from ws.manager import manager
from . import windowService, windowModel as wm

# Sync endpoints on purpose: they hold row locks and run the stock engines, so they belong
# in the threadpool, not on the event loop.
router = APIRouter(prefix="/windows", tags=["Sale windows"])


@router.get("/", response_model=List[wm.WindowResponse])
def list_windows(db: Session = Depends(get_session), current_user=Depends(get_current_user)):
    """The current cashier's open windows. Does not count as activity."""
    return windowService.list_my_windows(db, current_user)


@router.post("/", response_model=wm.WindowResponse)
def open_window(
    payload: wm.WindowOpenRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    result = windowService.open_window(db, current_user, payload)
    background_tasks.add_task(manager.broadcast, "windows_updated")
    return result


@router.get("/{window_id}", response_model=wm.WindowResponse)
def get_window(window_id: int, db: Session = Depends(get_session), current_user=Depends(get_current_user)):
    return windowService.get_window(db, window_id, current_user)


@router.put("/{window_id}/cart", response_model=wm.WindowResponse)
def set_cart(
    window_id: int,
    payload: wm.WindowCartRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    """Replace the window's cart; its stock is held immediately. 409 = stale version,
    410 = window closed/expired, 422 = the cart can't be filled from stock."""
    result = windowService.set_cart(db, window_id, current_user, payload)
    background_tasks.add_task(manager.broadcast, "products_updated")
    background_tasks.add_task(manager.broadcast, "windows_updated")
    return result


@router.post("/{window_id}/touch", response_model=wm.WindowResponse)
def touch_window(window_id: int, db: Session = Depends(get_session), current_user=Depends(get_current_user)):
    """Restart the window's 15-minute idle clock (e.g. the cashier switched to it)."""
    return windowService.touch_window(db, window_id, current_user)


@router.post("/{window_id}/confirm", response_model=wm.WindowConfirmResponse)
def confirm_window(
    window_id: int,
    payload: wm.WindowConfirmRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    result = windowService.confirm_window(db, window_id, current_user, payload)
    background_tasks.add_task(manager.broadcast, "orders_updated")
    background_tasks.add_task(manager.broadcast, "products_updated")
    background_tasks.add_task(manager.broadcast, "cutting_status_updated")
    background_tasks.add_task(manager.broadcast, "windows_updated")
    return result


@router.delete("/{window_id}", response_model=wm.WindowReleaseResponse)
def release_window(
    window_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    """Close without confirming: everything the window held goes back to stock."""
    result = windowService.release_window(db, window_id, current_user)
    background_tasks.add_task(manager.broadcast, "products_updated")
    background_tasks.add_task(manager.broadcast, "windows_updated")
    return result
