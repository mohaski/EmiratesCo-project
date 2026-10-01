"""Run the stock/ledger/journal consistency checks (core/audit/integrity.py). Read-only.

    python check_integrity.py                          # the app's database
    python check_integrity.py --db emiratesco_edit_test
"""
import sys

from sqlmodel import Session, create_engine

import entities  # noqa: F401
from config import settings
from core.audit import integrity


def main():
    url = settings.get_database_url()
    if "--db" in sys.argv:
        url = url.rpartition("/")[0] + "/" + sys.argv[sys.argv.index("--db") + 1]
    with Session(create_engine(url)) as db:
        result = integrity.check(db)
    for w in result["warnings"]:
        print("WARN ", w)
    for e in result["errors"][:200]:
        print("ERROR", e)
    print(f"{len(result['errors'])} error(s), {len(result['warnings'])} warning(s)")
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
