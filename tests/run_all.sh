#!/usr/bin/env bash
# Backend suites, service tests, then every browser suite. Servers as in tests/README.md.
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "### backend"; "$DIR/run_backend_tests.sh"
echo "### browser"; "$DIR/run_browser_suites.sh"
