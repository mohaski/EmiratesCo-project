#!/usr/bin/env bash
# Every server-side suite (server/test_*.py) plus the service tests in tests/service, on the
# test database. Usage: tests/run_backend_tests.sh [log-dir]
source "$(dirname "$0")/_testdb.sh"
OUT="${1:-$TESTS/.logs/backend}"; mkdir -p "$OUT"
# Suites that need the fixture product (id 15) recreated first.
LIVEFIX=" test_cancel_refund_sync.py test_payment_credit_sync.py test_order_persistence.py test_price_fallback.py "
cd "$SERVER" || exit 1
for t in test_*.py; do
  [[ "$LIVEFIX" == *" $t "* ]] && "$PY" "$TESTS/fixture_product15.py" >/dev/null 2>&1
  # Sale-window suites start from the QA seed (users, products, order numbers +1000).
  [[ "$t" == test_sale_windows* || "$t" == test_backend_audit.py ]] && seed
  ALLOW_LIVE_TESTS=0 "$PY" "$t" > "$OUT/$t.log" 2>&1; rc=$?
  p=$(grep -cE "\[PASS\]|^PASS|  PASS " "$OUT/$t.log"); f=$(grep -cE "\[FAIL\]|^FAIL|  FAIL " "$OUT/$t.log")
  echo "$t exit=$rc pass=$p fail=$f"
done
seed
for t in "$TESTS"/service/test_*.py; do
  n=$(basename "$t"); "$PY" "$t" > "$OUT/$n.log" 2>&1; rc=$?
  echo "$n exit=$rc $(tail -1 "$OUT/$n.log")"
done
