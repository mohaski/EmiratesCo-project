#!/usr/bin/env bash
# Every browser suite (tests/e2e), each on a fresh QA seed. Needs the test backend on :8010
# (DATABASE_URL=test DB, CORS_ORIGINS=http://localhost:5180) and Vite on :5180
# (VITE_API_URL=http://localhost:8010 VITE_WS_URL=ws://localhost:8010/ws) - see tests/README.md.
# Usage: tests/run_browser_suites.sh [suite ...]
# A suite FAILS on node's non-zero exit code. The script exits 1 if any suite failed.
source "$(dirname "$0")/_testdb.sh"
claim_test_db
OUT="$TESTS/.logs/browser"; mkdir -p "$OUT"
FAILED=()
SUITES=("$@")
[[ ${#SUITES[@]} -eq 0 ]] && SUITES=(suite suite_g2 edit_session_suite suite_g3 suite_g4 suite_g5 suite_g6 suite_g7 security_api suite_windows suite_offcuts suite_provisional)
for s in "${SUITES[@]}"; do
  seed
  if [[ $s == suite_g3 ]]; then  # its PIN check assumes a cancel PIN exists
    TOK=$(curl -s -X POST http://localhost:8010/users/token -d "username=qa_ceo&password=Test1234!" | "$PY" -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
    curl -s -o /dev/null -X PUT http://localhost:8010/settings/cancel-pin -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d '{"pin":"1357"}'
  fi
  node "$TESTS/e2e/$s.cjs" > "$OUT/$s.log" 2>&1; rc=$?
  if [[ $rc -eq 0 ]]; then tag="ok  "; else tag="FAIL"; FAILED+=("$s"); fi
  echo "$tag $s exit=$rc: $(grep -E 'passed|FAIL|Error' "$OUT/$s.log" | tr '\n' ' ' | cut -c1-300)"
done
echo
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "BROWSER: ${#FAILED[@]} suite(s) FAILED: ${FAILED[*]}"; exit 1
fi
echo "BROWSER: all suites passed"
