import secrets

from fastapi import APIRouter, BackgroundTasks, Depends, File, Header, HTTPException, Request, UploadFile, status

from config import settings
from core.userManagement.authService import get_current_user
from utils import require_role
from ws.manager import manager
from . import model, service

router = APIRouter(prefix="/failover", tags=["Failover"])


def verify_peer_secret(x_failover_secret: str = Header(None)):
    """Auth for the two peer-facing routes — the caller is another machine's
    backend process, not a logged-in browser session, so this checks a shared
    secret instead of a user JWT."""
    if not settings.FAILOVER_SHARED_SECRET or not secrets.compare_digest(
        x_failover_secret or "", settings.FAILOVER_SHARED_SECRET
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing failover secret")
    return True


# ── Manager-facing (own machine, JWT auth) ──────────────────────────────────

@router.post("/push", response_model=model.PushResponse)
def push(background_tasks: BackgroundTasks, current_user=Depends(get_current_user)):
    require_role(["manager", "ceo"], current_user)
    result = service.push_to_peer(current_user)
    background_tasks.add_task(manager.broadcast, "failover_status_updated")
    return result


@router.get("/status", response_model=model.FailoverStatusResponse)
def get_status(current_user=Depends(get_current_user)):
    require_role(["manager", "ceo"], current_user)
    return service.get_status(current_user)


# ── Peer-facing (shared secret, no JWT) ─────────────────────────────────────

@router.get("/ping", response_model=model.PingResponse)
def ping(_=Depends(verify_peer_secret)):
    return service.ping()


@router.post("/receive-backup")
def receive_backup(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    _=Depends(verify_peer_secret),
):
    peer_host = request.client.host if request.client else None
    result = service.receive_backup(file, peer_host)
    background_tasks.add_task(manager.broadcast, "failover_status_updated")
    return result
