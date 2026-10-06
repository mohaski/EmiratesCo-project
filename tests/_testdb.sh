# Sourced by the runners: paths, and DATABASE_URL pointing at the throwaway test database.
# Every suite here writes to (and some truncate) the database they are given - never live.
TESTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$TESTS")"
SERVER="$ROOT/server"
PY="$SERVER/.venv/bin/python"
TEST_DB="${TEST_DB:-emiratesco_edit_test}"
DATABASE_URL="$(cd "$SERVER" && "$PY" -c "
from sqlalchemy.engine import make_url
from db.database import DATABASE_URL
print(make_url(DATABASE_URL).set(database='$TEST_DB').render_as_string(hide_password=False))" 2>/dev/null | tail -1)"
export DATABASE_URL
seed() { (cd "$SERVER" && "$PY" "$TESTS/seed_ui_test_db.py" >/dev/null 2>&1); }

# One run at a time: the suites truncate shared tables, so two runs on the test database (or
# a person and an agent testing together) wipe each other's data mid-run and fail for no real
# reason. A runner calls claim_test_db first; a second runner refuses instead of interfering.
claim_test_db() {
  LOCKDIR="${TMPDIR:-/tmp}/${TEST_DB}.testrun.lock"
  if ! mkdir "$LOCKDIR" 2>/dev/null; then
    echo "Another test run is using $TEST_DB (pid $(cat "$LOCKDIR/pid" 2>/dev/null || echo '?'))."
    echo "Wait for it, or if no run is going: rm \"$LOCKDIR/pid\"; rmdir \"$LOCKDIR\""
    exit 2
  fi
  echo $$ > "$LOCKDIR/pid"
  trap 'rm -f "$LOCKDIR/pid"; rmdir "$LOCKDIR" 2>/dev/null' EXIT
}
