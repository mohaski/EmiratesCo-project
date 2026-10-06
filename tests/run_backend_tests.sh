#!/usr/bin/env bash
# Every server-side suite (server/test_*.py) plus the service tests in tests/service, on the
# test database. Usage: tests/run_backend_tests.sh [log-dir]
# A suite FAILS on a non-zero exit code - never on what it prints. pass/fail counts are shown
# for information only. The script exits 1 if any suite failed.
source "$(dirname "$0")/_testdb.sh"
claim_test_db
OUT="${1:-$TESTS/.logs/backend}"; mkdir -p "$OUT"
FAILED=()
report() {  # name exit-code info
  if [[ $2 -eq 0 ]]; then echo "ok    $1 $3"; else echo "FAIL  $1 exit=$2 $3"; FAILED+=("$1"); fi
}
# Suites that need the fixture product (id 15) recreated first.
LIVEFIX=" test_cancel_refund_sync.py test_payment_credit_sync.py test_order_persistence.py test_price_fallback.py "
cd "$SERVER" || exit 1
for t in test_*.py; do
  [[ "$LIVEFIX" == *" $t "* ]] && "$PY" "$TESTS/fixture_product15.py" >/dev/null 2>&1
  # Sale-window suites start from the QA seed (users, products, order numbers +1000).
  [[ "$t" == test_sale_windows* || "$t" == test_backend_audit.py ]] && seed
  ALLOW_LIVE_TESTS=0 "$PY" "$t" > "$OUT/$t.log" 2>&1; rc=$?
  p=$(grep -cE "\[PASS\]|^PASS|  PASS " "$OUT/$t.log"); f=$(grep -cE "\[FAIL\]|^FAIL|  FAIL " "$OUT/$t.log")
  report "$t" "$rc" "pass=$p fail=$f"
done
seed
for t in "$TESTS"/service/test_*.py; do
  n=$(basename "$t"); "$PY" "$t" > "$OUT/$n.log" 2>&1; rc=$?
  report "$n" "$rc" "$(tail -1 "$OUT/$n.log")"
done
echo
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "BACKEND: ${#FAILED[@]} suite(s) FAILED: ${FAILED[*]}"; exit 1
fi
echo "BACKEND: all suites passed"
