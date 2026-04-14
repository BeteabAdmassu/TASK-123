#!/bin/bash
# TalentOps - Test Runner
# Waits for services to be healthy, then runs unit tests and integration tests.
set -e

BASE_URL="${BASE_URL:-http://localhost:3000/api}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:4200}"
export BASE_URL
export FRONTEND_URL

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ============================================================
# Wait for services to be healthy
# ============================================================
echo -e "${YELLOW}=== Waiting for services to be healthy ===${NC}"

MAX_WAIT=120
WAITED=0

echo "Waiting for backend (${BASE_URL}/health)..."
until curl -sf "${BASE_URL}/health" > /dev/null 2>&1; do
  WAITED=$((WAITED + 2))
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${RED}ERROR: Backend did not become healthy within ${MAX_WAIT}s${NC}"
    exit 1
  fi
  sleep 2
done
echo -e "${GREEN}Backend is healthy${NC}"

echo "Waiting for frontend (${FRONTEND_URL})..."
WAITED=0
until curl -sf "${FRONTEND_URL}" > /dev/null 2>&1; do
  WAITED=$((WAITED + 2))
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${YELLOW}WARNING: Frontend not reachable, continuing with API tests only${NC}"
    break
  fi
  sleep 2
done

# ============================================================
# Unit tests (backend Jest)
# ============================================================
echo ""
echo -e "${YELLOW}=== Running Unit Tests ===${NC}"
UNIT_EXIT=0
(cd "$(dirname "$0")/backend" && npm test) || UNIT_EXIT=$?

# ============================================================
# Integration tests
# ============================================================
echo ""
INTEGRATION_EXIT=0
bash "$(dirname "$0")/tests/integration/api.sh" || INTEGRATION_EXIT=$?

# ============================================================
# Combined result
# ============================================================
echo ""
if [ $UNIT_EXIT -ne 0 ] || [ $INTEGRATION_EXIT -ne 0 ]; then
  echo -e "${RED}=== TEST SUITE FAILED (unit=$UNIT_EXIT integration=$INTEGRATION_EXIT) ===${NC}"
  exit 1
else
  echo -e "${GREEN}=== ALL TESTS PASSED ===${NC}"
  exit 0
fi
