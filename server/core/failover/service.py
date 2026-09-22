import json
import os
import socket
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import HTTPException, UploadFile, status
from sqlalchemy import text

from config import settings
from db.database import engine
from loggiing import logger
from . import model

BACKUPS_DIR = Path(__file__).resolve().parent.parent.parent / "backups"
STATE_FILE = Path(__file__).resolve().parent.parent.parent / "failover_state.json"
HISTORY_CAP = 20

# Single-process lock — NSSM runs this app with --workers 1, so a plain
# threading.Lock is enough to stop a double-click or a peer double-post from
# running two pg_restore operations against the same database at once.
_operation_lock = threading.Lock()


# ── State file (survives DB restores/wipes since it lives outside Postgres) ─

def _default_state() -> dict:
    return {"last_push": None, "last_receive": None, "history": []}


def _read_state() -> dict:
    if not STATE_FILE.exists():
        return _default_state()
    try:
        return json.loads(STATE_FILE.read_text())
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"failover_state.json unreadable ({e}) — resetting")
        return _default_state()


def _atomic_write(state: dict) -> None:
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(STATE_FILE)


def _write_event(
    direction: str,
    success: bool,
    detail: str,
    peer: Optional[str] = None,
    duration_seconds: Optional[float] = None,
) -> None:
    record = model.FailoverEventRecord(
        direction=direction,
        timestamp=datetime.now(timezone.utc),
        success=success,
        detail=detail,
        peer=peer,
        duration_seconds=duration_seconds,
    )
    record_dict = record.model_dump(mode="json")

    state = _read_state()
    state["last_push" if direction == "push" else "last_receive"] = record_dict
    history = state.setdefault("history", [])
    history.insert(0, record_dict)
    state["history"] = history[:HISTORY_CAP]
    _atomic_write(state)


# ── pg_dump / pg_restore subprocess helpers ─────────────────────────────────

def get_pg_bin(binary_name: str) -> str:
    exe = Path(settings.PG_BIN_DIR) / f"{binary_name}.exe"
    if not exe.exists():
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"{binary_name}.exe not found at {exe} — check PG_BIN_DIR in .env",
        )
    return str(exe)


def _run_pg(binary_name: str, args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    exe = get_pg_bin(binary_name)
    env = {**os.environ, "PGPASSWORD": settings.DB_PASSWORD}
    try:
        result = subprocess.run(
            [exe, *args], capture_output=True, text=True, timeout=300, env=env
        )
    except subprocess.TimeoutExpired as e:
        raise HTTPException(
            status.HTTP_504_GATEWAY_TIMEOUT, f"{binary_name} timed out"
        ) from e
    if check and result.returncode != 0:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"{binary_name} failed: {result.stderr.strip()[:500]}",
        )
    return result


def _dump_database(out_path: Path) -> None:
    _run_pg(
        "pg_dump",
        [
            "-h", settings.DB_HOST,
            "-p", str(settings.DB_PORT),
            "-U", settings.DB_USER,
            "-F", "c",
            "-f", str(out_path),
            settings.DB_NAME,
        ],
    )


def _restore_database(dump_path: Path) -> None:
    _run_pg(
        "pg_restore",
        [
            "--clean", "--if-exists", "--no-owner",
            "-h", settings.DB_HOST,
            "-p", str(settings.DB_PORT),
            "-U", settings.DB_USER,
            "-d", settings.DB_NAME,
            str(dump_path),
        ],
    )


def _terminate_other_backends() -> None:
    engine.dispose()
    with engine.connect() as conn:
        conn.execute(text(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = current_database() AND pid <> pg_backend_pid()"
        ))
        conn.commit()


def _machine_name() -> str:
    return settings.MACHINE_NAME or socket.gethostname()


# ── Push (manager-triggered, this machine → peer) ───────────────────────────

def push_to_peer(current_user) -> model.PushResponse:
    if not _operation_lock.acquire(blocking=False):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A failover operation is already in progress on this machine.",
        )
    try:
        if not settings.FAILOVER_PEER_URL:
            raise HTTPException(500, "FAILOVER_PEER_URL is not configured")
        if not settings.FAILOVER_SHARED_SECRET:
            raise HTTPException(500, "FAILOVER_SHARED_SECRET is not configured")

        start = time.perf_counter()
        BACKUPS_DIR.mkdir(exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        dump_path = BACKUPS_DIR / f"failover-push_{ts}.dump"

        _dump_database(dump_path)
        if dump_path.stat().st_size == 0:
            raise HTTPException(500, "pg_dump produced an empty file")

        peer_url = settings.FAILOVER_PEER_URL.rstrip("/")
        try:
            with open(dump_path, "rb") as f:
                resp = httpx.post(
                    f"{peer_url}/failover/receive-backup",
                    files={"file": (dump_path.name, f, "application/octet-stream")},
                    headers={"X-Failover-Secret": settings.FAILOVER_SHARED_SECRET},
                    timeout=httpx.Timeout(300.0, connect=10.0),
                )
        except httpx.RequestError as e:
            duration = time.perf_counter() - start
            _write_event("push", False, f"Could not reach peer: {e}", peer=peer_url, duration_seconds=duration)
            raise HTTPException(502, f"Could not reach peer at {peer_url}: {e}")

        duration = time.perf_counter() - start
        if resp.status_code != 200:
            detail = f"Peer rejected the backup (HTTP {resp.status_code}): {resp.text[:300]}"
            _write_event("push", False, detail, peer=peer_url, duration_seconds=duration)
            raise HTTPException(502, detail)

        _write_event(
            "push", True,
            f"Pushed {dump_path.stat().st_size} bytes to {peer_url}; peer restored OK",
            peer=peer_url, duration_seconds=duration,
        )
        logger.info(f"Failover push by user {current_user.userId} succeeded in {duration:.1f}s")
        return model.PushResponse(success=True, message="Backup pushed and restored on peer.", duration_seconds=duration)
    finally:
        _operation_lock.release()


# ── Receive (hit by the peer machine) ───────────────────────────────────────
# Deliberately a plain (sync) function, not async def: it does blocking
# subprocess/DB calls for up to several minutes, and FastAPI runs sync route
# handlers in a thread pool — an async def here would block the whole app's
# event loop (every other request, including live sales) for the duration.

def receive_backup(file: UploadFile, peer_host: Optional[str]) -> dict:
    if not _operation_lock.acquire(blocking=False):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A failover operation is already in progress on this machine.",
        )
    try:
        content = file.file.read()
        if len(content) > settings.MAX_FILE_SIZE:
            raise HTTPException(413, "Uploaded backup exceeds MAX_FILE_SIZE")
        if not content:
            raise HTTPException(422, "Uploaded backup file is empty")

        BACKUPS_DIR.mkdir(exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        recv_path = BACKUPS_DIR / f"failover-receive_{ts}.dump"
        recv_path.write_bytes(content)

        # Integrity check BEFORE anything destructive — a corrupt/partial
        # transfer must never be allowed near --clean.
        listing = _run_pg("pg_restore", ["--list", str(recv_path)], check=False)
        if listing.returncode != 0 or not listing.stdout.strip():
            detail = "Uploaded backup file failed integrity check (pg_restore --list)"
            _write_event("receive", False, detail, peer=peer_host)
            raise HTTPException(422, detail)

        # Safety backup of what's currently here, before we destroy it.
        safety_path = BACKUPS_DIR / f"pre-failover-safety_{ts}.dump"
        _dump_database(safety_path)

        _terminate_other_backends()

        try:
            _restore_database(recv_path)
        except HTTPException as restore_err:
            try:
                _restore_database(safety_path)
                detail = (
                    f"RESTORE FAILED: {restore_err.detail}; "
                    f"auto-rollback to safety backup SUCCEEDED"
                )
            except HTTPException as rollback_err:
                detail = (
                    f"RESTORE FAILED: {restore_err.detail}; auto-rollback ALSO FAILED "
                    f"({rollback_err.detail}) — manual intervention required, "
                    f"safety backup at {safety_path}"
                )
            finally:
                engine.dispose()
            _write_event("receive", False, detail, peer=peer_host)
            raise HTTPException(500, detail)

        engine.dispose()
        _write_event(
            "receive", True,
            f"Restored {len(content)} bytes from {peer_host or 'unknown peer'}",
            peer=peer_host,
        )
        return {"success": True}
    finally:
        _operation_lock.release()


# ── Status / ping ────────────────────────────────────────────────────────────

def get_status(current_user) -> model.FailoverStatusResponse:
    state = _read_state()

    peer_reachable = False
    peer_error: Optional[str] = None
    peer_machine_name: Optional[str] = None

    if not settings.FAILOVER_PEER_URL:
        peer_error = "FAILOVER_PEER_URL is not configured"
    else:
        peer_url = settings.FAILOVER_PEER_URL.rstrip("/")
        try:
            r = httpx.get(
                f"{peer_url}/failover/ping",
                headers={"X-Failover-Secret": settings.FAILOVER_SHARED_SECRET},
                timeout=httpx.Timeout(5.0, connect=3.0),
            )
            if r.status_code == 200:
                peer_reachable = True
                peer_machine_name = r.json().get("machine_name")
            else:
                peer_error = f"Peer responded with HTTP {r.status_code}"
        except httpx.RequestError as e:
            peer_error = str(e)

    return model.FailoverStatusResponse(
        machine_name=_machine_name(),
        peer_url=settings.FAILOVER_PEER_URL,
        peer_reachable=peer_reachable,
        peer_machine_name=peer_machine_name,
        peer_error=peer_error,
        last_push=state.get("last_push"),
        last_receive=state.get("last_receive"),
        history=state.get("history", []),
        operation_in_progress=_operation_lock.locked(),
    )


def ping() -> model.PingResponse:
    return model.PingResponse(machine_name=_machine_name())
