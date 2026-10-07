import os
import time
import asyncio
import logging
import pathlib
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from db.database import create_db_and_tables, get_session, check_db_health
from entities import *

# Import Controllers
from core.ordering.controller import router as ordering_router
from core.ordering.windowController import router as windows_router
from core.inventory.products.controller import router as products_router
from core.inventory.attributes.controller import router as attributes_router
from core.inventory.stockSessions.controller import router as stock_sessions_router
from core.inventory.openContainers.controller import router as open_containers_router
from core.financials.controller import router as financials_router
from core.userManagement.controller import router as users_router
from core.messaging.controller import router as messaging_router
from core.invoices.controller import router as invoices_router
from core.settings.controller import router as settings_router
from core.tools.controller import router as tools_router
from core.failover.controller import router as failover_router
from ws.router import router as ws_router

# ── Logging Setup ────────────────────────────────────────────────────────────
# Configured once, in loggiing.py (imported by every service before this runs).
import loggiing  # noqa: F401,E402
logger = logging.getLogger("emiratesco")

# ── Lifespan (replaces deprecated on_event) ──────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀  EmiratesCo API starting up …")
    create_db_and_tables()
    logger.info("✅  Database tables verified.")
    sweeper = asyncio.create_task(_expire_idle_windows_forever())
    yield
    sweeper.cancel()
    logger.info("👋  EmiratesCo API shutting down.")


WINDOW_SWEEP_SECONDS = 30


async def _expire_idle_windows_forever():
    """Release sale windows idle past their 15 minutes (core/ordering/windowService.py),
    so a closed tab or a crashed till never keeps stock locked away. Runs in a worker
    thread: releasing a window takes row locks and runs the stock engines.

    Skipped while a failover push/receive is running: a receive rebuilds the database
    with pg_restore --clean, and giving stock back into a half-restored database would
    corrupt it. Windows that arrive with the restored data expire on a later sweep."""
    from ws.manager import manager

    while True:
        try:
            await asyncio.sleep(WINDOW_SWEEP_SECONDS)
            if await asyncio.to_thread(sweep_idle_windows_once):
                await manager.broadcast("products_updated")
                await manager.broadcast("windows_updated")
                from core.ordering.windowService import drain_handover_notices
                for notice in drain_handover_notices():
                    await manager.broadcast("bar_handed_over", notice)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # never let one bad sweep stop the sweeper
            logger.error(f"Sale window sweeper failed: {e}", exc_info=True)


def sweep_idle_windows_once() -> int:
    """One sweep; 0 without touching anything while a failover push/receive holds its lock."""
    from core.ordering.windowService import expire_idle_windows
    from core.failover.service import _operation_lock

    if _operation_lock.locked():
        return 0
    return expire_idle_windows()

# ── App Instance ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="EmiratesCo API",
    description="Aluminium & Glass Management System — REST API",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── Middleware Stack ──────────────────────────────────────────────────────────
# Starlette applies middleware in REVERSE insertion order (last added = outermost).
# Desired order (outermost → innermost): CORS → Timing → GZip → Router

# 1. GZip compression for responses > 1 kB (innermost — closest to the router)
app.add_middleware(GZipMiddleware, minimum_size=1024)

# 2. Request timing + correlation ID
@app.middleware("http")
async def timing_and_request_id(request: Request, call_next):
    start = time.perf_counter()
    request_id = request.headers.get("X-Request-ID", f"req-{int(time.time() * 1000)}")

    response: Response = await call_next(request)

    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Response-Time"] = f"{elapsed_ms:.1f}ms"

    if elapsed_ms > 500:
        logger.warning(
            f"[{request_id}] SLOW {request.method} {request.url.path} — {elapsed_ms:.0f}ms"
        )
    else:
        logger.info(
            f"[{request_id}] {request.method} {request.url.path} → {response.status_code} ({elapsed_ms:.0f}ms)"
        )

    return response

# 3. CORS — added LAST so it is outermost; all responses (including errors) get CORS headers
# Frontend is served same-origin from this same process in production (see the
# static-file mount below), so CORS only matters for local dev (Vite on 5173)
# or any extra origins added via CORS_ORIGINS in .env.
_extra = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        *_extra,
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Request-ID"],
    expose_headers=["X-Request-ID", "X-Response-Time"],
    max_age=3600,
)

# ── Routers ──────────────────────────────────────────────────────────────────
app.include_router(ordering_router)
app.include_router(windows_router)
app.include_router(invoices_router)
app.include_router(products_router)
app.include_router(attributes_router)
app.include_router(stock_sessions_router)
app.include_router(open_containers_router)
app.include_router(financials_router)
app.include_router(users_router)
app.include_router(messaging_router)
app.include_router(settings_router)
app.include_router(tools_router)
app.include_router(failover_router)
app.include_router(ws_router)

# ── Utility Endpoints ─────────────────────────────────────────────────────────
@app.get("/api/status", tags=["System"])
async def root():
    return {
        "service": "EmiratesCo API",
        "version": "2.0.0",
        "status": "running",
        "docs": "/docs",
    }

@app.get("/health", tags=["System"])
async def health_check():
    """
    Detailed health probe.
    Returns DB pool stats useful for monitoring dashboards.
    """
    db_status = check_db_health()
    is_healthy = db_status["status"] == "healthy"
    return JSONResponse(
        status_code=200 if is_healthy else 503,
        content={
            "status": "healthy" if is_healthy else "degraded",
            "database": db_status,
            "version": "2.0.0",
        },
    )

# ── Frontend (served same-origin in production) ──────────────────────────────
# Registered LAST: Starlette matches routes in registration order, so every
# API route/router above still wins before this catch-all is ever reached.
CLIENT_DIST = pathlib.Path(__file__).resolve().parent.parent / "client" / "dist"

if CLIENT_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=CLIENT_DIST / "assets"), name="assets")

    # A browser page load (Accept: text/html) of an app route that shares its path with an
    # API route — /orders, /orders/review, /users, /tools — used to be answered by the API
    # (raw JSON / a 401) whenever no service worker intercepted the navigation: first visit,
    # a hard reload, a fresh browser. Page loads get the app; the app's own requests
    # (axios: Accept application/json) and real files never ask for HTML.
    _NOT_PAGES = ("/docs", "/redoc", "/openapi.json", "/assets", "/ws")

    @app.middleware("http")
    async def serve_app_for_page_loads(request: Request, call_next):
        path = request.url.path
        if (request.method == "GET"
                and "text/html" in request.headers.get("accept", "")
                and not path.startswith(_NOT_PAGES)
                and "." not in path.rsplit("/", 1)[-1]):
            return FileResponse(CLIENT_DIST / "index.html")
        return await call_next(request)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        candidate = CLIENT_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(CLIENT_DIST / "index.html")
else:
    logger.info("No client/dist found — frontend not mounted (API-only mode).")
