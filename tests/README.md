# Tests

Everything here runs against the **throwaway test database `emiratesco_edit_test`**. The seed
and many suites truncate tables. Every script refuses any other database, and none of them
should ever be pointed at live.

| Folder / script | What it is |
|---|---|
| `../server/test_*.py` | Server suites: stock engines, offcut ledger, edits, corrections, undo, sale windows |
| `service/` | Service-level checks: money rules, payment status, group 5 and 7 fixes |
| `e2e/*.cjs` | Browser suites (Playwright) through the real UI, plus `security_api.cjs` over HTTP |
| `seed_ui_test_db.py` | Resets the test DB to the QA seed: `qa_*` users (password `Test1234!`), QA products and customers, order numbers +1000 above ids |
| `fixture_product15.py` | Recreates the product a few older suites expect as id 15 |

## One-time setup
```bash
createdb emiratesco_edit_test            # or copy the schema from a backup
cd server && DATABASE_URL=<test db url> .venv/bin/python migrate_sale_windows.py
```

## Running
```bash
tests/run_backend_tests.sh               # server suites + service tests (no servers needed)
```

The browser suites need a backend and the client running against the test DB:
```bash
# terminal 1 - backend on :8010 against the test DB
cd server && DATABASE_URL=<test db url> CORS_ORIGINS=http://localhost:5180 \
  .venv/bin/python -m uvicorn main:app --port 8010
# terminal 2 - client on :5180 talking to it
cd client && VITE_API_URL=http://localhost:8010 VITE_WS_URL=ws://localhost:8010/ws \
  npx vite --port 5180 --strictPort
# terminal 3
tests/run_browser_suites.sh              # all suites, or name some: tests/run_browser_suites.sh suite_windows
tests/run_all.sh                         # backend, then browser
```

The runners work out the test DB URL from `server/.env` themselves. Logs go to `tests/.logs/`.

**Pass/fail is the exit code.** A suite fails when it exits non-zero; the `pass=`/`fail=` counts
in the summary are information only. Each runner prints a final `BACKEND:` / `BROWSER:` line and
exits 1 if any suite failed (`run_all.sh` too). A suite that only prints results without
exiting non-zero on a failure is a bug in the suite.

**One run at a time.** The suites truncate shared tables, so a runner takes a lock on the test
database and a second run refuses (exit 2) rather than wiping the first one's data mid-run.

Every Python script refuses to run anywhere but the test database (`server/_testdb_guard.py`, or
its own `current_database()` check).
Each browser suite starts from a fresh seed. `suite_windows` switches sale windows on itself;
every other suite runs with them off, which is the default.
