"""
Run real service code against the LIVE database, then throw every change away.

    from live_rollback import live_session
    with live_session() as db:
        orderService.update_order(190, request, db, user)   # really runs, really commits...
        ...                                                 # ...inspect the result...
    # ...and none of it persisted.

The session is bound to a connection inside an outer transaction with
join_transaction_mode="create_savepoint", so each db.commit() the service code issues only
releases a SAVEPOINT; the outer transaction is rolled back on exit, success or failure.
Row locks taken with FOR UPDATE are real, so avoid running this while the till is busy.

The one thing that does survive a rollback in Postgres is sequence advancement: ids handed
out inside the block are burned, leaving gaps. Harmless, but it is why this is not free to
run in a tight loop.
"""
from contextlib import contextmanager

from sqlmodel import Session

from db.database import engine


@contextmanager
def live_session():
    connection = engine.connect()
    outer = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        connection.close()
