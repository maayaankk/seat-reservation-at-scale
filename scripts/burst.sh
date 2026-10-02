#!/usr/bin/env bash
set -euo pipefail

# burst.sh - Parameterized stampede test
# Usage: ./burst.sh <BASE_URL> [ADMIN_TOKEN] --users N --requests M --hot-seats "A1,A2" --retry-rate 0.1

BASE_URL="${1:-}"
ADMIN_TOKEN="${2:-}"
shift 2 || true

USERS=5000
REQUESTS=20000
HOT_SEATS="A12"
RETRY_RATE=0.15
CONCURRENCY=1000
SEATS_PER_REQUEST=1
JSON_OUT=""
TIMEOUT_MS=30000
JWT_SECRET=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --users) USERS="$2"; shift 2 ;;
    --requests) REQUESTS="$2"; shift 2 ;;
    --hot-seats) HOT_SEATS="$2"; shift 2 ;;
    --retry-rate) RETRY_RATE="$2"; shift 2 ;;
    --concurrency) CONCURRENCY="$2"; shift 2 ;;
    --seats-per-request) SEATS_PER_REQUEST="$2"; shift 2 ;;
    --json-out) JSON_OUT="$2"; shift 2 ;;
    --admin-token) ADMIN_TOKEN="$2"; shift 2 ;;
    --secret) JWT_SECRET="$2"; shift 2 ;;
    --timeout-ms) TIMEOUT_MS="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$BASE_URL" ]]; then
  echo "Usage: $0 <BASE_URL> [ADMIN_TOKEN] --users N --requests M --hot-seats \"A1,A2\" --retry-rate 0.1"
  exit 1
fi

BASE_URL="${BASE_URL%/}"

echo "=== Burst Test Configuration ==="
echo "Base URL: $BASE_URL"
echo "Users: $USERS"
echo "Requests: $REQUESTS"
echo "Hot seats: $HOT_SEATS"
echo "Retry rate: $RETRY_RATE"
echo "Concurrency: $CONCURRENCY"
echo "Seats per request: $SEATS_PER_REQUEST"
echo "Timeout: ${TIMEOUT_MS}ms"
echo ""

if [[ -z "$JWT_SECRET" ]]; then
  JWT_SECRET="dev-secret-change-in-production-min-32-chars-long"
fi

if [[ -z "$ADMIN_TOKEN" ]]; then
  ADMIN_TOKEN="dev-admin-token-change-in-production"
fi

if ! command -v node &> /dev/null; then
  echo "Error: node not found in PATH"
  exit 1
fi

if [[ ! -f "dist/scripts/burst.js" ]]; then
  echo "Building project..."
  npm run build > /dev/null 2>&1 || { echo "Build failed"; exit 1; }
fi

node dist/scripts/burst.js \
  --base-url "$BASE_URL" \
  --admin-token "$ADMIN_TOKEN" \
  --jwt-secret "$JWT_SECRET" \
  --users "$USERS" \
  --requests "$REQUESTS" \
  --hot-seats "$HOT_SEATS" \
  --retry-rate "$RETRY_RATE" \
  --concurrency "$CONCURRENCY" \
  --seats-per-request "$SEATS_PER_REQUEST" \
  --timeout-ms "$TIMEOUT_MS" \
  ${JSON_OUT:+--json-out "$JSON_OUT"}

EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo ""
  echo "=== BURST TEST FAILED ==="
  exit $EXIT_CODE
fi

echo ""
echo "=== BURST TEST PASSED ==="
exit 0