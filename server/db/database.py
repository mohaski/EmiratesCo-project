from sqlmodel import SQLModel, create_engine
from sqlalchemy import Engine, event, text
from sqlalchemy.pool import QueuePool
from typing import Generator
from sqlmodel import Session
import sys
import os
import logging

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import settings

logger = logging.getLogger(__name__)

DATABASE_URL = settings.get_database_url()

# ── Connection Pool Configuration ──────────────────────────────────────────
# QueuePool with tuned settings for a POS workload:
#   - pool_size: persistent connections kept alive
#   - max_overflow: burst connections on top of pool_size
#   - pool_timeout: seconds to wait before raising OperationalError
#   - pool_recycle: recycle connections after N seconds (prevents stale TCP issues)
#   - pool_pre_ping: lightweight SELECT 1 check before handing out each connection

engine: Engine = create_engine(
    DATABASE_URL,
    echo=settings.DEBUG,
    poolclass=QueuePool,
    pool_size=10,
    max_overflow=20,
    pool_timeout=30,
    pool_recycle=1800,      # 30 min – prevents "server closed the connection" in prod
    pool_pre_ping=True,     # validate connection health before use
    connect_args={
        "connect_timeout": 10,
        "application_name": "EmiratesCo-API",
        "options": "-c statement_timeout=30000",   # 30 s query timeout
    },
)

# ── Session-level performance settings ─────────────────────────────────────
@event.listens_for(engine, "connect")
def set_session_defaults(dbapi_connection, connection_record):
    """Apply per-connection defaults for performance."""
    try:
        with dbapi_connection.cursor() as cursor:
            # Synchronous commit is slower but safer; disable for read-heavy sessions
            # cursor.execute("SET synchronous_commit = off")  # Uncomment for higher write throughput (risk: recent data loss on crash)
            cursor.execute("SET work_mem = '16MB'")          # Improve sort/hash perf
            cursor.execute("SET random_page_cost = 1.1")    # SSD tuning
    except Exception as e:
        logger.warning(f"Could not set session defaults: {e}")


def create_db_and_tables():
    """Create all database tables defined in SQLModel metadata."""
    SQLModel.metadata.create_all(engine)
    logger.info("Database tables verified/created.")


def get_session() -> Generator[Session, None, None]:
    """
    Dependency-injectable database session.
    Automatically commits on clean exit or rolls back on exception.
    """
    with Session(engine) as session:
        try:
            yield session
        except Exception:
            session.rollback()
            raise


def check_db_health() -> dict:
    """Lightweight DB health probe used by the /health endpoint."""
    try:
        with Session(engine) as session:
            session.exec(text("SELECT 1"))  # type: ignore[arg-type]
        pool = engine.pool
        return {
            "status": "healthy",
            "pool_size": pool.size(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
        }
    except Exception as e:
        logger.error(f"DB health check failed: {e}")
        return {"status": "unhealthy", "error": str(e)}
