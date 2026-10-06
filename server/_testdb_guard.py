"""Refuse to run a test script anywhere but the throwaway test database.

The suites write real orders, payments and credits. Run from server/ with the plain .env,
DATABASE_URL points at the live database, so a script without this guard writes test sales
into the shop's books. tests/run_backend_tests.sh points DATABASE_URL at the test database.
"""
from sqlalchemy import text

TEST_DATABASES = ("emiratesco_edit_test", "emiratesco_sw_test")


def require_test_db(engine) -> str:
    with engine.connect() as c:
        name = c.execute(text("SELECT current_database()")).scalar()
    if name not in TEST_DATABASES:
        raise SystemExit(f"Refusing to run against {name!r}: this script writes orders. Point "
                         "DATABASE_URL at emiratesco_edit_test (tests/run_backend_tests.sh does).")
    return name
