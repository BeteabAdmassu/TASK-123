#!/bin/bash
# TalentOps - Test Runner
# Waits for services to be healthy, then runs:
#   1. Backend Jest unit + integration tests (inside the backend container)
#   2. Shell-based API smoke tests
#   3. Angular Karma unit tests (frontend-test Docker container)
#   4. Playwright E2E tests (e2e Docker container, hits real stack)
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3000/api}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:4200}"
export BASE_URL
export FRONTEND_URL

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }

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
pass "Backend is healthy"

FRONTEND_READY=false
echo "Waiting for frontend (${FRONTEND_URL})..."
WAITED=0
until curl -sf "${FRONTEND_URL}" > /dev/null 2>&1; do
  WAITED=$((WAITED + 2))
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${YELLOW}WARNING: Frontend not reachable, skipping frontend/E2E tests${NC}"
    break
  fi
  sleep 2
done
if curl -sf "${FRONTEND_URL}" > /dev/null 2>&1; then
  FRONTEND_READY=true
  pass "Frontend is healthy"
fi

# ============================================================
# 1. Backend Jest unit + TypeScript integration tests
# ============================================================
echo ""
echo -e "${YELLOW}=== Running Backend Unit & Integration Tests ===${NC}"
UNIT_EXIT=0
(cd "$REPO_DIR" && docker compose exec -T backend npm test) || UNIT_EXIT=$?
if [ $UNIT_EXIT -eq 0 ]; then
  pass "Backend tests passed"
else
  fail "Backend tests FAILED (exit $UNIT_EXIT)"
fi

# ============================================================
# 2. Shell-based API smoke tests
# ============================================================
echo ""
echo -e "${YELLOW}=== Running API Smoke Tests ===${NC}"
INTEGRATION_EXIT=0
bash "$REPO_DIR/tests/integration/api.sh" || INTEGRATION_EXIT=$?
if [ $INTEGRATION_EXIT -eq 0 ]; then
  pass "API smoke tests passed"
else
  fail "API smoke tests FAILED (exit $INTEGRATION_EXIT)"
fi

# ============================================================
# 3. Frontend Angular unit tests (Karma inside Docker)
# ============================================================
echo ""
echo -e "${YELLOW}=== Running Frontend Unit Tests ===${NC}"
FRONTEND_UNIT_EXIT=0
# Build step: capture docker's own exit code via PIPESTATUS, not tail's
(cd "$REPO_DIR" && docker compose --profile test build frontend-test 2>&1 | tail -5; exit "${PIPESTATUS[0]}") \
  || FRONTEND_UNIT_EXIT=$?
if [ $FRONTEND_UNIT_EXIT -ne 0 ]; then
  fail "Frontend-test image build failed (exit $FRONTEND_UNIT_EXIT)"
else
  (cd "$REPO_DIR" && docker compose --profile test run --rm frontend-test) || FRONTEND_UNIT_EXIT=$?
  if [ $FRONTEND_UNIT_EXIT -eq 0 ]; then
    pass "Frontend unit tests passed"
  else
    fail "Frontend unit tests FAILED (exit $FRONTEND_UNIT_EXIT)"
  fi
fi

# ============================================================
# 4. Playwright E2E tests (requires frontend to be up)
# ============================================================
echo ""
echo -e "${YELLOW}=== Running E2E Tests ===${NC}"
E2E_EXIT=0
if [ "$FRONTEND_READY" = "true" ]; then
  # Build step: propagate docker's exit code correctly
  (cd "$REPO_DIR" && docker compose --profile test build e2e 2>&1 | tail -5; exit "${PIPESTATUS[0]}") \
    || E2E_EXIT=$?
  if [ $E2E_EXIT -ne 0 ]; then
    fail "E2E image build failed (exit $E2E_EXIT)"
  else
    (cd "$REPO_DIR" && docker compose --profile test run --rm e2e) || E2E_EXIT=$?
    if [ $E2E_EXIT -eq 0 ]; then
      pass "E2E tests passed"
    else
      fail "E2E tests FAILED (exit $E2E_EXIT)"
    fi
  fi
else
  echo -e "${YELLOW}SKIP: Frontend unreachable — E2E tests skipped${NC}"
fi

# ============================================================
# Combined result
# ============================================================
echo ""
TOTAL_FAIL=0
if [ $UNIT_EXIT -ne 0 ];          then TOTAL_FAIL=$((TOTAL_FAIL + 1)); fi
if [ $INTEGRATION_EXIT -ne 0 ];   then TOTAL_FAIL=$((TOTAL_FAIL + 1)); fi
if [ $FRONTEND_UNIT_EXIT -ne 0 ]; then TOTAL_FAIL=$((TOTAL_FAIL + 1)); fi
if [ $E2E_EXIT -ne 0 ];           then TOTAL_FAIL=$((TOTAL_FAIL + 1)); fi

if [ $TOTAL_FAIL -ne 0 ]; then
  echo -e "${RED}=== TEST SUITE FAILED (backend=$UNIT_EXIT smoke=$INTEGRATION_EXIT frontend=$FRONTEND_UNIT_EXIT e2e=$E2E_EXIT) ===${NC}"
  exit 1
else
  echo -e "${GREEN}=== ALL TESTS PASSED ===${NC}"
  exit 0
fi
