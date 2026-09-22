from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class PingResponse(BaseModel):
    machine_name: str
    status: str = "ok"


class FailoverEventRecord(BaseModel):
    """One entry in failover_state.json's event log."""
    direction: str  # "push" | "receive"
    timestamp: datetime
    success: bool
    detail: str
    peer: Optional[str] = None
    duration_seconds: Optional[float] = None


class FailoverStatusResponse(BaseModel):
    machine_name: str
    peer_url: str
    peer_reachable: bool
    peer_machine_name: Optional[str] = None
    peer_error: Optional[str] = None
    last_push: Optional[FailoverEventRecord] = None
    last_receive: Optional[FailoverEventRecord] = None
    history: list[FailoverEventRecord] = []
    operation_in_progress: bool


class PushResponse(BaseModel):
    success: bool
    message: str
    duration_seconds: float
