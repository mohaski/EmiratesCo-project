from fastapi import APIRouter, Depends, BackgroundTasks
from sqlmodel import Session
from typing import List, Optional

from db.database import get_session
from core.userManagement.authService import get_current_user
from ws.manager import manager
from utils import require_role
from . import model, service, utilization

router = APIRouter(prefix="/open-containers", tags=["Open Containers"])

# Opening and closing a pack is a claim about the physical floor, so it's
# restricted to the roles that are accountable for stock. Reads stay open to
# any signed-in user because the sales screen needs to know whether anything is
# open before it will allow a sub-pack sale.
_STOCK_ROLES = ["ceo", "manager", "admin"]


@router.get("/", response_model=List[model.OpenContainerResponse])
def list_containers(
    status: Optional[str] = "open",
    product_id: Optional[int] = None,
    limit: int = 200,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    """status='open' (default) for what is currently dispensing, 'finished' for
    history, or blank for everything."""
    return service.list_containers(db, status or None, product_id, limit)


@router.get("/openable", response_model=List[model.OpenableVariantResponse])
def list_openable(
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return service.list_openable(db)


@router.get("/yield/{variant_id}", response_model=model.YieldHistoryResponse)
def yield_history(
    variant_id: int,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return service.yield_history(variant_id, db)


# ── CEO utilization reporting ────────────────────────────────────────────────
# Restricted to the oversight roles: these expose per-pack revenue and the gap
# between what a pack yielded and what was billed out of it.
_OVERSIGHT_ROLES = ["ceo", "admin"]


@router.get("/utilization", response_model=List[model.VariantUtilizationRow])
def variant_utilization(
    product_id: Optional[int] = None,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    """Per-variant rollup of every pack ever opened -- how many were consumed,
    what they actually yielded against their label, and how much never got
    billed."""
    require_role(_OVERSIGHT_ROLES, current_user)
    return utilization.variant_utilization(db, product_id)


@router.get("/{container_id}/usage", response_model=model.ContainerUsageResponse)
def container_usage(
    container_id: int,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    """Every sale that drew from one pack -- the drill-down behind a history row."""
    require_role(_OVERSIGHT_ROLES, current_user)
    return utilization.container_usage(container_id, db)


@router.post("/products/{product_id}", response_model=model.OpenContainerResponse)
async def open_container(
    product_id: int,
    payload: model.OpenContainerCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    require_role(_STOCK_ROLES, current_user)
    result = service.open_container(product_id, payload, db, current_user)
    # products_updated because opening moved a pack out of stock_quantity; the
    # sales screen also has to re-check whether a sub-pack sale is now allowed.
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result


@router.post("/{container_id}/close", response_model=model.OpenContainerResponse)
async def close_container(
    container_id: int,
    payload: model.OpenContainerClose,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    require_role(_STOCK_ROLES, current_user)
    result = service.close_container(container_id, payload, db, current_user)
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result


@router.post("/{container_id}/reopen", response_model=model.OpenContainerResponse)
async def reopen_container(
    container_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    require_role(_STOCK_ROLES, current_user)
    result = service.reopen_container(container_id, db, current_user)
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result


@router.delete("/{container_id}")
async def cancel_container(
    container_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    """Opened in error -- returns the pack to sealed stock. Refused once units
    have been dispensed (see service.cancel_container)."""
    require_role(_STOCK_ROLES, current_user)
    result = service.cancel_container(container_id, db, current_user)
    background_tasks.add_task(manager.broadcast, "products_updated")
    return result
