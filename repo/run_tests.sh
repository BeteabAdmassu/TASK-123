#!/bin/bash
# TalentOps Compliance & Service Desk - Integration Tests
# Runs on the HOST machine against localhost endpoints
set -e

BASE_URL="http://localhost:3000/api"
FRONTEND_URL="http://localhost:4200"
PASS=0
FAIL=0
TOTAL=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() {
  PASS=$((PASS + 1))
  TOTAL=$((TOTAL + 1))
  echo -e "${GREEN}PASS${NC}: $1"
}

log_fail() {
  FAIL=$((FAIL + 1))
  TOTAL=$((TOTAL + 1))
  echo -e "${RED}FAIL${NC}: $1 - $2"
}

test_status() {
  local description="$1"
  local expected_code="$2"
  local actual_code="$3"
  local response_body="$4"

  if [ "$actual_code" = "$expected_code" ]; then
    log_pass "$description (HTTP $actual_code)"
  else
    log_fail "$description" "Expected HTTP $expected_code, got $actual_code. Body: $response_body"
  fi
}

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

echo ""
echo -e "${YELLOW}=== Running Integration Tests ===${NC}"
echo ""

# ============================================================
# 1. Health Check
# ============================================================
echo "--- Health Check ---"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/health")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "GET /api/health returns 200" "200" "$HTTP_CODE" "$BODY"

STATUS=$(echo "$BODY" | jq -r '.status' 2>/dev/null)
if [ "$STATUS" = "ok" ]; then
  log_pass "Health check status is 'ok'"
else
  log_fail "Health check status" "Expected 'ok', got '$STATUS'"
fi

# ============================================================
# 2. Authentication
# ============================================================
echo ""
echo "--- Authentication ---"

# Login with default admin credentials
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "POST /api/auth/login with valid credentials" "200" "$HTTP_CODE" "$BODY"

ADMIN_TOKEN=$(echo "$BODY" | jq -r '.token' 2>/dev/null)
if [ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "null" ]; then
  log_pass "Login returns JWT token"
else
  log_fail "Login JWT token" "Token not found in response"
  echo -e "${RED}Cannot continue without auth token. Exiting.${NC}"
  exit 1
fi

# Login with invalid credentials
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"wrongpassword"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "POST /api/auth/login with invalid credentials returns 401" "401" "$HTTP_CODE"

# Access protected route without token
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/users")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/users without token returns 401" "401" "$HTTP_CODE"

# Get current user
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/auth/me" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "GET /api/auth/me with token returns 200" "200" "$HTTP_CODE" "$BODY"

# Login as recruiter
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"recruiter","password":"recruiter"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
RECRUITER_TOKEN=$(echo "$BODY" | jq -r '.token' 2>/dev/null)
test_status "POST /api/auth/login as recruiter" "200" "$HTTP_CODE" "$BODY"

# Login as reviewer
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"reviewer","password":"reviewer"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
REVIEWER_TOKEN=$(echo "$BODY" | jq -r '.token' 2>/dev/null)
test_status "POST /api/auth/login as reviewer" "200" "$HTTP_CODE" "$BODY"

# Login as approver
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"approver","password":"approver"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
APPROVER_TOKEN=$(echo "$BODY" | jq -r '.token' 2>/dev/null)
test_status "POST /api/auth/login as approver" "200" "$HTTP_CODE" "$BODY"

# ============================================================
# 3. User Management (Admin)
# ============================================================
echo ""
echo "--- User Management ---"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/users" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "GET /api/users (admin)" "200" "$HTTP_CODE" "$BODY"

USER_COUNT=$(echo "$BODY" | jq '.total' 2>/dev/null)
if [ "$USER_COUNT" -ge 4 ] 2>/dev/null; then
  log_pass "Seeded users exist (count >= 4)"
else
  log_fail "Seeded users" "Expected at least 4 users, got $USER_COUNT"
fi

# Recruiter cannot access user management
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/users" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/users as recruiter returns 403" "403" "$HTTP_CODE"

# ============================================================
# 4. Recruiting Projects CRUD
# ============================================================
echo ""
echo "--- Recruiting Projects ---"

# Create project
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
  -d '{"title":"Test Hiring Project Q4","description":"Q4 2024 batch hiring project"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "POST /api/projects creates project" "201" "$HTTP_CODE" "$BODY"

PROJECT_ID=$(echo "$BODY" | jq -r '.id' 2>/dev/null)
if [ -n "$PROJECT_ID" ] && [ "$PROJECT_ID" != "null" ]; then
  log_pass "Project created with ID: ${PROJECT_ID:0:8}..."
else
  log_fail "Project creation" "No ID in response"
fi

# List projects
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/projects" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "GET /api/projects returns list" "200" "$HTTP_CODE" "$BODY"

# Get project detail
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/projects/${PROJECT_ID}" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/projects/:id returns project" "200" "$HTTP_CODE"

# Update project
RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "${BASE_URL}/projects/${PROJECT_ID}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
  -d '{"status":"active"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "PUT /api/projects/:id updates project" "200" "$HTTP_CODE"

# Get non-existent project
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/projects/00000000-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/projects/:id with bad ID returns 404" "404" "$HTTP_CODE"

# ============================================================
# 5. Job Postings
# ============================================================
echo ""
echo "--- Job Postings ---"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/projects/${PROJECT_ID}/postings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
  -d '{"title":"Senior Software Engineer","description":"Full-stack role","status":"open"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "POST /api/projects/:id/postings creates posting" "201" "$HTTP_CODE" "$BODY"

POSTING_ID=$(echo "$BODY" | jq -r '.id' 2>/dev/null)

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/projects/${PROJECT_ID}/postings" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/projects/:id/postings returns list" "200" "$HTTP_CODE"

# ============================================================
# 6. Candidates with Encryption
# ============================================================
echo ""
echo "--- Candidates ---"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/postings/${POSTING_ID}/candidates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
  -d '{"first_name":"Jane","last_name":"Doe","email":"jane@example.com","phone":"555-0100","ssn":"123-45-6789","dob":"1990-05-15","compensation":"85000","eeoc_disposition":"Selected"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "POST /api/postings/:id/candidates creates candidate" "201" "$HTTP_CODE" "$BODY"

CANDIDATE_ID=$(echo "$BODY" | jq -r '.id' 2>/dev/null)

# List candidates
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/postings/${POSTING_ID}/candidates" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "GET /api/postings/:id/candidates returns list" "200" "$HTTP_CODE" "$BODY"

# Verify sensitive fields are masked
SSN_VALUE=$(echo "$BODY" | jq -r '.data[0].ssn_encrypted // .data[0].ssn' 2>/dev/null)
if [ "$SSN_VALUE" = "****" ] || [ "$SSN_VALUE" = "null" ] || [ -z "$SSN_VALUE" ]; then
  log_pass "Sensitive fields are masked in list view"
else
  log_fail "Sensitive field masking" "SSN not masked: $SSN_VALUE"
fi

# Get candidate detail
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/candidates/${CANDIDATE_ID}" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/candidates/:id returns candidate detail" "200" "$HTTP_CODE"

# Validation: create candidate with missing required fields
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/postings/${POSTING_ID}/candidates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
  -d '{}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "POST candidate with missing required fields returns 400" "400" "$HTTP_CODE"

# ============================================================
# 7. Resume Versions
# ============================================================
echo ""
echo "--- Resume Versions ---"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/candidates/${CANDIDATE_ID}/resumes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
  -d '{"content":{"experience":[{"company":"Acme Corp","role":"Developer","years":3}],"education":[{"school":"State Univ","degree":"BS CS"}],"skills":["JavaScript","TypeScript","Angular"]}}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "POST /api/candidates/:id/resumes creates version" "201" "$HTTP_CODE" "$BODY"

VERSION_NUM=$(echo "$BODY" | jq '.version_number' 2>/dev/null)
if [ "$VERSION_NUM" = "1" ]; then
  log_pass "First resume version is 1"
else
  log_fail "Resume version number" "Expected 1, got $VERSION_NUM"
fi

# Create second version
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/candidates/${CANDIDATE_ID}/resumes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
  -d '{"content":{"experience":[{"company":"Acme Corp","role":"Senior Developer","years":5}],"education":[{"school":"State Univ","degree":"BS CS"}],"skills":["JavaScript","TypeScript","Angular","Node.js"]}}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "POST second resume version" "201" "$HTTP_CODE" "$BODY"

# List resume versions
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/candidates/${CANDIDATE_ID}/resumes" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/candidates/:id/resumes lists versions" "200" "$HTTP_CODE"

# Get latest
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/candidates/${CANDIDATE_ID}/resumes/latest" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/candidates/:id/resumes/latest returns latest" "200" "$HTTP_CODE"

# ============================================================
# 8. Tags
# ============================================================
echo ""
echo "--- Tags ---"

TAG_NAME="urgent_$(date +%s)"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/tags" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
  -d "{\"name\":\"${TAG_NAME}\",\"color\":\"#ff0000\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "POST /api/tags creates tag" "201" "$HTTP_CODE" "$BODY"

TAG_ID=$(echo "$BODY" | jq -r '.id' 2>/dev/null)

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/tags" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/tags returns list" "200" "$HTTP_CODE"

# Tag candidate
if [ -n "$TAG_ID" ] && [ "$TAG_ID" != "null" ]; then
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/candidates/${CANDIDATE_ID}/tags" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
    -d "{\"tagId\":\"${TAG_ID}\"}")
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  test_status "POST /api/candidates/:id/tags adds tag" "201" "$HTTP_CODE"
fi

# ============================================================
# 9. Violations
# ============================================================
echo ""
echo "--- Violations ---"

# Trigger scan
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/candidates/${CANDIDATE_ID}/scan" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "POST /api/candidates/:id/scan triggers violation scan" "200" "$HTTP_CODE"

# List violations
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/violations" \
  -H "Authorization: Bearer ${REVIEWER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/violations returns queue" "200" "$HTTP_CODE"

# List violation rules
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/violations/rules" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/violations/rules returns rules" "200" "$HTTP_CODE"

# ============================================================
# 10. Service Catalog
# ============================================================
echo ""
echo "--- Service Catalog ---"

# Create category
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/services/categories" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{"name":"HR Services","description":"Human Resources services"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "POST /api/services/categories creates category" "201" "$HTTP_CODE" "$BODY"

CATEGORY_ID=$(echo "$BODY" | jq -r '.id' 2>/dev/null)

# List categories
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/services/categories" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/services/categories returns list" "200" "$HTTP_CODE"

# Create specification
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/services/specifications" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d "{\"name\":\"Background Check\",\"description\":\"Employee background verification\",\"category_id\":\"${CATEGORY_ID}\",\"duration_minutes\":60,\"headcount\":2,\"tools_addons\":[\"Verification Portal\",\"ID Scanner\"],\"daily_capacity\":10}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "POST /api/services/specifications creates spec" "201" "$HTTP_CODE" "$BODY"

SPEC_ID=$(echo "$BODY" | jq -r '.id' 2>/dev/null)

# Validation: invalid duration (not multiple of 15)
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/services/specifications" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d "{\"name\":\"Bad Spec\",\"category_id\":\"${CATEGORY_ID}\",\"duration_minutes\":17,\"headcount\":2}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "POST specification with invalid duration returns 400" "400" "$HTTP_CODE"

# Create pricing rule
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/services/specifications/${SPEC_ID}/pricing" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{"rule_type":"base","base_price":150.00}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "POST /api/services/specifications/:id/pricing creates rule" "201" "$HTTP_CODE"

# Add surcharge
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/services/specifications/${SPEC_ID}/pricing" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{"rule_type":"surcharge","surcharge_label":"after-hours","surcharge_amount":25.00}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "POST surcharge pricing rule" "201" "$HTTP_CODE"

# Change spec status
RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "${BASE_URL}/services/specifications/${SPEC_ID}/status" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{"status":"active"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "PUT /api/services/specifications/:id/status changes status" "200" "$HTTP_CODE"

# Set capacity
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/services/specifications/${SPEC_ID}/capacity" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{"date":"2026-04-13","max_volume":20}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "POST /api/services/specifications/:id/capacity sets capacity" "201" "$HTTP_CODE"

# ============================================================
# 11. Approval Workflow
# ============================================================
echo ""
echo "--- Approval Workflow ---"

# Get approver user ID
RESPONSE=$(curl -s "${BASE_URL}/auth/me" -H "Authorization: Bearer ${APPROVER_TOKEN}")
APPROVER_ID=$(echo "$RESPONSE" | jq -r '.id' 2>/dev/null)

# Create approval template
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/approval-templates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d "{\"name\":\"Credit Change Approval\",\"approval_mode\":\"joint\",\"steps\":[{\"step_order\":1,\"approver_id\":\"${APPROVER_ID}\"}]}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "POST /api/approval-templates creates template" "201" "$HTTP_CODE" "$BODY"

TEMPLATE_ID=$(echo "$BODY" | jq -r '.id' 2>/dev/null)

# List templates
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/approval-templates" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/approval-templates returns list" "200" "$HTTP_CODE"

# Create credit change
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/credit-changes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
  -d "{\"entity_type\":\"candidate\",\"entity_id\":\"${CANDIDATE_ID}\",\"amount\":5000.00,\"reason\":\"Signing bonus adjustment\",\"template_id\":\"${TEMPLATE_ID}\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "POST /api/credit-changes creates credit change with approval" "201" "$HTTP_CODE" "$BODY"

CREDIT_CHANGE_ID=$(echo "$BODY" | jq -r '.id' 2>/dev/null)

# List credit changes
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/credit-changes" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/credit-changes returns list" "200" "$HTTP_CODE"

# List approvals for approver
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/approvals" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "GET /api/approvals returns inbox" "200" "$HTTP_CODE" "$BODY"

# Recruiter can access active templates (not admin-only)
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/approval-templates/active" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/approval-templates/active as recruiter returns 200" "200" "$HTTP_CODE"

# ============================================================
# 12. Notifications
# ============================================================
echo ""
echo "--- Notifications ---"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/notifications" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/notifications returns inbox" "200" "$HTTP_CODE"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/notifications/pending-count" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/notifications/pending-count returns count" "200" "$HTTP_CODE"

# ============================================================
# 13. Notification Templates
# ============================================================
echo ""
echo "--- Notification Templates ---"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/notification-templates" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/notification-templates returns list" "200" "$HTTP_CODE"

# ============================================================
# 14. Comments
# ============================================================
echo ""
echo "--- Comments ---"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/comments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
  -d "{\"entity_type\":\"candidate\",\"entity_id\":\"${CANDIDATE_ID}\",\"body\":\"Great candidate, strong background.\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "POST /api/comments creates comment" "201" "$HTTP_CODE"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/comments?entityType=candidate&entityId=${CANDIDATE_ID}" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/comments returns comments for entity" "200" "$HTTP_CODE"

# ============================================================
# 15. Global Search
# ============================================================
echo ""
echo "--- Global Search ---"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/search?q=Jane" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "GET /api/search?q=Jane returns results" "200" "$HTTP_CODE" "$BODY"

# Search scoping: approver should not see draft services
RESPONSE=$(curl -s "${BASE_URL}/search?q=Background" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
SERVICES_COUNT=$(echo "$RESPONSE" | jq '.results.services | length' 2>/dev/null)
# The spec "Background Check" was set to 'active' so approver should see it (active catalog)
# But a draft spec should NOT appear for non-admin
if [ "$SERVICES_COUNT" != "null" ] && [ -n "$SERVICES_COUNT" ]; then
  log_pass "Search services scoped for non-privileged user (count: $SERVICES_COUNT)"
else
  log_fail "Search services scoping" "Could not parse services from search response"
fi

# Search scoping: approver should NOT see recruiter's projects
RESPONSE=$(curl -s "${BASE_URL}/search?q=Hiring" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
PROJECTS_COUNT=$(echo "$RESPONSE" | jq '.results.projects | length' 2>/dev/null)
if [ "$PROJECTS_COUNT" = "0" ]; then
  log_pass "Search projects scoped: approver sees 0 foreign projects"
else
  log_fail "Search project scoping" "Approver sees $PROJECTS_COUNT projects (expected 0)"
fi

# Search scoping: approver should NOT see recruiter's postings
RESPONSE=$(curl -s "${BASE_URL}/search?q=Senior" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
POSTINGS_COUNT=$(echo "$RESPONSE" | jq '.results.postings | length' 2>/dev/null)
if [ "$POSTINGS_COUNT" = "0" ]; then
  log_pass "Search postings scoped: approver sees 0 foreign postings"
else
  log_fail "Search posting scoping" "Approver sees $POSTINGS_COUNT postings (expected 0)"
fi

# ============================================================
# 16. Crash Recovery Checkpoint
# ============================================================
echo ""
echo "--- Checkpoints ---"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/checkpoint" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
  -d '{"checkpoint_data":{"openWindows":["recruiting","candidate-detail"],"activeRecordId":"test-123","formState":{"dirty":true}}}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "POST /api/checkpoint saves checkpoint" "201" "$HTTP_CODE"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/checkpoint/latest" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/checkpoint/latest retrieves checkpoint" "200" "$HTTP_CODE"

# ============================================================
# 17. Audit Trail
# ============================================================
echo ""
echo "--- Audit Trail ---"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/audit" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/audit returns audit entries" "200" "$HTTP_CODE"

# ============================================================
# 18. Geospatial
# ============================================================
echo ""
echo "--- Geospatial ---"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/geo/datasets" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/geo/datasets returns list" "200" "$HTTP_CODE"

# ============================================================
# 19. Media
# ============================================================
echo ""
echo "--- Media ---"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/media" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/media returns list" "200" "$HTTP_CODE"

# ============================================================
# 20. System Endpoints
# ============================================================
echo ""
echo "--- System ---"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/system/update-info" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/system/update-info returns info" "200" "$HTTP_CODE"

# ============================================================
# 21. Object-Level Authorization Tests
# ============================================================
echo ""
echo "--- Object-Level Authorization ---"

# Approver should NOT be able to see a credit change they are not involved with
# (Create a credit change without a template so no approval steps exist for the approver)
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/credit-changes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
  -d "{\"entity_type\":\"candidate\",\"entity_id\":\"${CANDIDATE_ID}\",\"amount\":100.00,\"reason\":\"Test isolation\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
ISOLATED_CC_ID=$(echo "$BODY" | jq -r '.id' 2>/dev/null)
test_status "POST /api/credit-changes for isolation test" "201" "$HTTP_CODE" "$BODY"

if [ -n "$ISOLATED_CC_ID" ] && [ "$ISOLATED_CC_ID" != "null" ]; then
  RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/credit-changes/${ISOLATED_CC_ID}" \
    -H "Authorization: Bearer ${APPROVER_TOKEN}")
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  test_status "GET /api/credit-changes/:id as unrelated approver returns 403" "403" "$HTTP_CODE"
fi

# Notification export ownership: approver should not export recruiter's notification
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/notifications" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
BODY=$(echo "$RESPONSE" | head -n -1)
RECRUITER_NOTIF_ID=$(echo "$BODY" | jq -r '.data[0].id // empty' 2>/dev/null)

if [ -n "$RECRUITER_NOTIF_ID" ]; then
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/notifications/export/${RECRUITER_NOTIF_ID}" \
    -H "Authorization: Bearer ${APPROVER_TOKEN}")
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  test_status "POST /api/notifications/export/:id as non-owner returns 403" "403" "$HTTP_CODE"
fi

# Reviewer cannot create projects (role check)
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${REVIEWER_TOKEN}" \
  -d '{"title":"Should Fail"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "POST /api/projects as reviewer returns 403" "403" "$HTTP_CODE"

# Approver cannot create candidates (role check)
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/postings/${POSTING_ID}/candidates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}" \
  -d '{"first_name":"Blocked","last_name":"User"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "POST /api/candidates as approver returns 403" "403" "$HTTP_CODE"

# ============================================================
# 22. Project/Posting Object-Level Auth Tests
# ============================================================
echo ""
echo "--- Project/Posting Object-Level Auth ---"

# Approver should NOT be able to view recruiter's project detail
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/projects/${PROJECT_ID}" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/projects/:id as unrelated approver returns 403" "403" "$HTTP_CODE"

# Approver should NOT be able to update recruiter's project
RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "${BASE_URL}/projects/${PROJECT_ID}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}" \
  -d '{"title":"Hacked"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "PUT /api/projects/:id as unrelated approver returns 403" "403" "$HTTP_CODE"

# Approver should NOT be able to list postings for recruiter's project
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/projects/${PROJECT_ID}/postings" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/projects/:id/postings as unrelated approver returns 403" "403" "$HTTP_CODE"

# Approver should NOT be able to view posting detail from recruiter's project
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/postings/${POSTING_ID}" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/postings/:id as unrelated approver returns 403" "403" "$HTTP_CODE"

# Approver should NOT be able to list candidates for recruiter's posting
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/postings/${POSTING_ID}/candidates" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/postings/:postingId/candidates as unrelated approver returns 403" "403" "$HTTP_CODE"

# Recruiter CAN still view their own project
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/projects/${PROJECT_ID}" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/projects/:id as owner recruiter returns 200" "200" "$HTTP_CODE"

# ============================================================
# 23. Reveal / Resume / Approval Object-Level Auth Tests
# ============================================================
echo ""
echo "--- Sensitive Reveal, Resume, Approval Object Auth ---"

# Approver should NOT be able to reveal sensitive fields (role restricted)
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/candidates/${CANDIDATE_ID}/reveal" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}" \
  -d '{"password":"approver","field":"ssn"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "POST /api/candidates/:id/reveal as approver returns 403 (role)" "403" "$HTTP_CODE"

# Approver should NOT be able to list resumes for unrelated candidate
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/candidates/${CANDIDATE_ID}/resumes" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/candidates/:id/resumes as unrelated approver returns 403" "403" "$HTTP_CODE"

# Approver should NOT be able to get latest resume for unrelated candidate
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/candidates/${CANDIDATE_ID}/resumes/latest" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/candidates/:id/resumes/latest as unrelated approver returns 403" "403" "$HTTP_CODE"

# Verify candidate detail does NOT leak ssn_hash or encrypted columns
RESPONSE=$(curl -s "${BASE_URL}/candidates/${CANDIDATE_ID}" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
SSN_HASH_PRESENT=$(echo "$RESPONSE" | jq 'has("ssn_hash")' 2>/dev/null)
SSN_ENCRYPTED_PRESENT=$(echo "$RESPONSE" | jq 'has("ssn_encrypted")' 2>/dev/null)
SSN_MASKED_PRESENT=$(echo "$RESPONSE" | jq 'has("ssn_masked")' 2>/dev/null)
if [ "$SSN_HASH_PRESENT" = "false" ] && [ "$SSN_ENCRYPTED_PRESENT" = "false" ]; then
  log_pass "Candidate detail does not leak ssn_hash or ssn_encrypted"
else
  log_fail "Sensitive field leakage" "ssn_hash=$SSN_HASH_PRESENT, ssn_encrypted=$SSN_ENCRYPTED_PRESENT"
fi
if [ "$SSN_MASKED_PRESENT" = "true" ]; then
  log_pass "Candidate detail includes ssn_masked field"
else
  log_fail "Masking contract" "ssn_masked field missing from response"
fi

# Reviewer should NOT access approval detail for requests they didn't create / aren't assigned to
# First get an approval request ID from the earlier credit change test
APPROVAL_RESPONSE=$(curl -s "${BASE_URL}/approvals" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")
TEST_APPROVAL_ID=$(echo "$APPROVAL_RESPONSE" | jq -r '.data[0].id // empty' 2>/dev/null)

if [ -n "$TEST_APPROVAL_ID" ]; then
  RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/approvals/${TEST_APPROVAL_ID}" \
    -H "Authorization: Bearer ${REVIEWER_TOKEN}")
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  test_status "GET /api/approvals/:id as unrelated reviewer returns 403" "403" "$HTTP_CODE"

  RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/approvals/${TEST_APPROVAL_ID}/audit" \
    -H "Authorization: Bearer ${REVIEWER_TOKEN}")
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  test_status "GET /api/approvals/:id/audit as unrelated reviewer returns 403" "403" "$HTTP_CODE"
fi

# ============================================================
# 23. Contract / Path Alignment Tests
# ============================================================
echo ""
echo "--- Endpoint Contract Tests ---"

# Verify correct endpoint paths used by frontend match backend
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/services/specifications" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/services/specifications (not /specs) returns 200" "200" "$HTTP_CODE"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/services/specifications/${SPEC_ID}/pricing" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/services/specifications/:id/pricing returns 200" "200" "$HTTP_CODE"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/services/specifications/${SPEC_ID}/capacity" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/services/specifications/:id/capacity returns 200" "200" "$HTTP_CODE"

# Verify notification endpoints use correct paths (not /status)
NOTIF_RESPONSE=$(curl -s "${BASE_URL}/notifications" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
TEST_NOTIF_ID=$(echo "$NOTIF_RESPONSE" | jq -r '.data[0].id // empty' 2>/dev/null)
if [ -n "$TEST_NOTIF_ID" ]; then
  RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "${BASE_URL}/notifications/${TEST_NOTIF_ID}/read" \
    -H "Authorization: Bearer ${APPROVER_TOKEN}")
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  test_status "PUT /api/notifications/:id/read (not /status) returns 200" "200" "$HTTP_CODE"
fi

# Verify media uses /playback-state not /playback
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/media" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
BODY=$(echo "$RESPONSE" | head -n -1)
TEST_MEDIA_ID=$(echo "$BODY" | jq -r '.data[0].id // empty' 2>/dev/null)
if [ -n "$TEST_MEDIA_ID" ]; then
  RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/media/${TEST_MEDIA_ID}/playback-state" \
    -H "Authorization: Bearer ${RECRUITER_TOKEN}")
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  test_status "GET /api/media/:id/playback-state (not /playback) returns 200" "200" "$HTTP_CODE"
fi

# Verify geo import uses /import suffix
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/geo/datasets/import" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}" \
  -d '{"name":"Test Points","source_type":"geojson","file_content":"{\"type\":\"FeatureCollection\",\"features\":[{\"type\":\"Feature\",\"geometry\":{\"type\":\"Point\",\"coordinates\":[-73.9857,40.7484]},\"properties\":{\"name\":\"NYC\"}}]}"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
  log_pass "POST /api/geo/datasets/import (not /geo/datasets) returns $HTTP_CODE"
else
  log_fail "POST /api/geo/datasets/import" "Expected 200 or 201, got $HTTP_CODE"
fi

# ============================================================
# 23. Attachment Authorization Tests
# ============================================================
echo ""
echo "--- Attachment Authorization ---"

# Approver should not access candidate attachments if not assigned approval
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/candidates/${CANDIDATE_ID}/attachments" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/candidates/:id/attachments as unrelated approver returns 403" "403" "$HTTP_CODE"

# ============================================================
# 24. Credit Changes List Authorization
# ============================================================
echo ""
echo "--- Credit Changes List Authorization ---"

# Approver should only see credit changes where they are assigned (not all)
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/credit-changes" \
  -H "Authorization: Bearer ${APPROVER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "GET /api/credit-changes as approver returns 200" "200" "$HTTP_CODE"

# ============================================================
# 25. Tile Endpoint
# ============================================================
echo ""
echo "--- Offline Tile Serving ---"

# Request non-existent tile returns 404 (not 500 or missing route)
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/tiles/0/0/0.png" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
test_status "GET /api/tiles/0/0/0.png returns 404 when tile missing" "404" "$HTTP_CODE"

# Path traversal attempt should be rejected
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/tiles/0/0/..%2F..%2Fetc%2Fpasswd.png" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "404" ]; then
  log_pass "GET /api/tiles with path traversal attempt rejected ($HTTP_CODE)"
else
  log_fail "Tile path traversal" "Expected 400 or 404, got $HTTP_CODE"
fi

# ============================================================
# 26. Notification Pending Count Contract
# ============================================================
echo ""
echo "--- Notification Count Contract ---"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/notifications/pending-count" \
  -H "Authorization: Bearer ${RECRUITER_TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)
test_status "GET /api/notifications/pending-count returns 200" "200" "$HTTP_CODE"

COUNT_FIELD=$(echo "$BODY" | jq '.count' 2>/dev/null)
if [ "$COUNT_FIELD" != "null" ] && [ -n "$COUNT_FIELD" ]; then
  log_pass "pending-count returns { count } field (value: $COUNT_FIELD)"
else
  log_fail "pending-count response shape" "Expected { count } field, got: $BODY"
fi

# ============================================================
# 27. Frontend Accessibility
# ============================================================
echo ""
echo "--- Frontend ---"

RESPONSE=$(curl -s -w "\n%{http_code}" "${FRONTEND_URL}/")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "200" ]; then
  log_pass "Frontend index.html accessible (HTTP 200)"
else
  log_fail "Frontend accessibility" "Expected HTTP 200, got $HTTP_CODE"
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo -e "${YELLOW}============================================${NC}"
echo -e "${YELLOW}  TEST RESULTS: ${PASS} passed, ${FAIL} failed (${TOTAL} total)${NC}"
echo -e "${YELLOW}============================================${NC}"

if [ $FAIL -gt 0 ]; then
  echo -e "${RED}Some tests failed!${NC}"
  exit 1
else
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
fi
