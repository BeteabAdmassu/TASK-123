# Test Coverage Audit

## Project Type Detection
- Declared: `Project Type: desktop, fullstack` (`repo/README.md:3`).
- Scope used: backend API + backend unit + frontend unit/component + E2E.

## Backend Endpoint Inventory
- Source: `repo/shared/api-contracts.ts` plus extra backend route `GET /api/tiles/:z/:x/:y` from `repo/backend/src/routes/geo.ts`.
- Total unique endpoints: **115**.

## API Test Classification
1. **True No-Mock HTTP**
   - `repo/tests/integration/api.sh` (real `curl` requests to live API)
   - `repo/tests/backend/integration/api.test.ts` (real `fetch` against running server)
   - `repo/tests/e2e/specs/*.ts` (browser flow over real FE/BE boundary)
2. **HTTP with Mocking**
   - None found in API-layer suites.
3. **Non-HTTP**
   - Backend unit/service route tests and frontend component/unit specs.

## API Test Mapping Table (Per Endpoint)

### Auth
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `POST /api/auth/login` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "POST /api/auth/login..."`; `describe('Auth API — payload contracts')` |
| `POST /api/auth/logout` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/auth/logout returns 200"` |
| `GET /api/auth/me` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "GET /api/auth/me..."`; `GET /api/auth/me returns...` |
| `POST /api/auth/verify-password` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/auth/verify-password..."` |

### Users
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/users` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/users (admin)"` |
| `POST /api/users` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/users creates user..."` |
| `PUT /api/users/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "PUT /api/users/:id updates user"` |
| `DELETE /api/users/:id` | No | Not covered | - | Declared in `repo/shared/api-contracts.ts` (`USERS.DELETE`); no matching HTTP test |

### Projects
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/projects` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "GET /api/projects returns list"`; `Projects API — CRUD round-trip` |
| `POST /api/projects` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "POST /api/projects creates project"`; `POST /api/projects returns 201...` |
| `GET /api/projects/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "GET /api/projects/:id returns project"`; `GET /api/projects/:id returns...` |
| `PUT /api/projects/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "PUT /api/projects/:id updates project"`; `PUT /api/projects/:id updates...` |
| `DELETE /api/projects/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "DELETE /api/projects/:id soft-deletes project"` |

### Postings
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/projects/:projectId/postings` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/projects/:id/postings returns list"` |
| `POST /api/projects/:projectId/postings` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "POST /api/projects/:id/postings creates posting"`; candidate setup in `api.test.ts` |
| `GET /api/postings/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/postings/:id returns posting detail"` |
| `PUT /api/postings/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "PUT /api/postings/:id updates posting"` |
| `DELETE /api/postings/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "DELETE /api/postings/:id removes posting"` |

### Candidates
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/postings/:postingId/candidates` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/postings/:id/candidates returns list"` |
| `POST /api/postings/:postingId/candidates` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "POST /api/postings/:id/candidates creates candidate"`; `Candidates API` |
| `GET /api/candidates/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "GET /api/candidates/:id returns candidate detail"`; `GET /api/candidates/:id returns...` |
| `PUT /api/candidates/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "PUT /api/candidates/:id updates candidate"`; `PUT /api/candidates/:id updates...` |
| `PUT /api/candidates/:id/status` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | status-transition block (`.../status returns 400/200`) |
| `POST /api/candidates/:id/reveal` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/candidates/:id/reveal..."` |
| `POST /api/candidates/:id/tags` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/candidates/:id/tags adds tag"` |
| `DELETE /api/candidates/:id/tags/:tagId` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "DELETE /api/candidates/:id/tags/:tagId removes tag"` |
| `POST /api/candidates/:id/request-materials` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/candidates/:id/request-materials sends notification"` |
| `POST /api/candidates/:id/scan` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/candidates/:id/scan triggers violation scan"` |

### Resumes
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/candidates/:candidateId/resumes` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/candidates/:id/resumes lists versions"` |
| `POST /api/candidates/:candidateId/resumes` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/candidates/:id/resumes creates version"` |
| `GET /api/resumes/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/resumes/:id returns specific version"` |
| `GET /api/candidates/:candidateId/resumes/latest` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/candidates/:id/resumes/latest returns latest"` |

### Attachments
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/candidates/:candidateId/attachments` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/candidates/:id/attachments returns list..."` |
| `POST /api/candidates/:candidateId/attachments` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/candidates/:id/attachments uploads attachment"` |
| `GET /api/attachments/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/attachments/:id returns attachment metadata"` |
| `GET /api/attachments/:id/download` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/attachments/:id/download returns file"` |
| `DELETE /api/attachments/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "DELETE /api/attachments/:id removes attachment"` |

### Violations
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/violations` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/violations returns queue"` |
| `GET /api/violations/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/violations/:id returns violation detail"` |
| `PUT /api/violations/:id/review` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "PUT /api/violations/:id/review reviews violation"` |
| `GET /api/violations/rules` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/violations/rules returns rules"` |
| `POST /api/violations/rules` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/violations/rules creates rule"` |
| `PUT /api/violations/rules/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "PUT /api/violations/rules/:id updates rule severity"` |

### Services / Pricing / Capacity
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/services/categories` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/services/categories returns list"` |
| `POST /api/services/categories` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/services/categories creates category"` |
| `PUT /api/services/categories/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "PUT /api/services/categories/:id updates category"` |
| `DELETE /api/services/categories/:id` | No | Not covered | - | Declared in `repo/shared/api-contracts.ts` (`SERVICES.CATEGORIES_DELETE`); no matching HTTP test |
| `GET /api/services/categories/:id/attributes` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/services/categories/:id/attributes returns list"` |
| `POST /api/services/categories/:id/attributes` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/services/categories/:id/attributes adds attribute"` |
| `GET /api/services/specifications` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/services/specifications (not /specs) returns 200"` |
| `POST /api/services/specifications` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/services/specifications creates spec"` |
| `GET /api/services/specifications/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/services/specifications/:id returns spec"` |
| `PUT /api/services/specifications/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "PUT /api/services/specifications/:id updates spec"` |
| `PUT /api/services/specifications/:id/status` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "PUT /api/services/specifications/:id/status changes status"` |
| `POST /api/services/specifications/:id/tags` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/services/specifications/:id/tags adds tag to spec"` |
| `DELETE /api/services/specifications/:id/tags/:tagId` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "DELETE /api/services/specifications/:id/tags/:tagId removes spec tag"` |
| `GET /api/services/specifications/:id/pricing` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/services/specifications/:id/pricing returns 200"` |
| `POST /api/services/specifications/:id/pricing` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/services/specifications/:id/pricing creates rule"` |
| `PUT /api/services/pricing/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "PUT /api/services/pricing/:id updates pricing rule"` |
| `DELETE /api/services/pricing/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "DELETE /api/services/pricing/:id removes pricing rule"` |
| `GET /api/services/specifications/:id/capacity` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/services/specifications/:id/capacity returns 200"` |
| `POST /api/services/specifications/:id/capacity` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/services/specifications/:id/capacity sets capacity"` |
| `PUT /api/services/capacity/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "PUT /api/services/capacity/:id updates capacity plan"` |

### Credit Changes
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/credit-changes` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/credit-changes returns list"` |
| `POST /api/credit-changes` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/credit-changes creates credit change..."` |
| `GET /api/credit-changes/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/credit-changes/:id ..."` |

### Approval Templates
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/approval-templates` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/approval-templates returns list"` |
| `GET /api/approval-templates/active` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/approval-templates/active..."` |
| `POST /api/approval-templates` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/approval-templates creates template"` |
| `GET /api/approval-templates/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/approval-templates/:id returns template detail"` |
| `PUT /api/approval-templates/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "PUT /api/approval-templates/:id updates template"` |
| `DELETE /api/approval-templates/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "DELETE /api/approval-templates/:id removes template"` |

### Approvals
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/approvals` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/approvals returns inbox"` |
| `POST /api/approvals` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/approvals creates standalone approval request"` |
| `GET /api/approvals/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/approvals/:id returns request with steps"` |
| `PUT /api/approvals/:id/steps/:stepId` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "PUT /api/approvals/:id/steps/:stepId submits approval decision"` |
| `GET /api/approvals/:id/audit` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/approvals/:id/audit returns audit trail"` |

### Notification Templates
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/notification-templates` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/notification-templates returns list"` |
| `POST /api/notification-templates` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/notification-templates creates template"` |
| `PUT /api/notification-templates/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "PUT /api/notification-templates/:id updates template"` |
| `DELETE /api/notification-templates/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "DELETE /api/notification-templates/:id removes template"` |

### Notifications
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/notifications` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "GET /api/notifications returns inbox"`; `describe('Notifications API...')` |
| `PUT /api/notifications/:id/read` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "PUT /api/notifications/:id/read..."` |
| `PUT /api/notifications/:id/acknowledge` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "PUT /api/notifications/:id/acknowledge..."` |
| `GET /api/notifications/pending-count` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "GET /api/notifications/pending-count..."` |
| `POST /api/notifications/export/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/notifications/export/:id as non-owner returns 403"` |

### Tags
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/tags` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "GET /api/tags returns list"`; `describe('Tags API...')` |
| `POST /api/tags` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "POST /api/tags creates tag"` |
| `PUT /api/tags/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "PUT /api/tags/:id updates tag"` |
| `DELETE /api/tags/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "DELETE /api/tags/:id removes tag"` |

### Comments
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/comments` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/comments returns comments for entity"` |
| `POST /api/comments` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/comments creates comment"` |
| `DELETE /api/comments/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "DELETE /api/comments/:id removes comment"` |

### Geospatial
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/geo/datasets` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/geo/datasets returns list"` |
| `POST /api/geo/datasets/import` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | import test block (`.../import`) |
| `GET /api/geo/datasets/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/geo/datasets/:id returns dataset detail"` |
| `DELETE /api/geo/datasets/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "DELETE /api/geo/datasets/:id removes dataset"` |
| `GET /api/geo/datasets/:id/features` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/geo/datasets/:id/features returns features"` |
| `GET /api/geo/datasets/:id/aggregate` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/geo/datasets/:id/aggregate..."` |
| `GET /api/geo/datasets/:id/density` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/geo/datasets/:id/density..."` |
| `GET /api/geo/datasets/:id/buffer` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/geo/datasets/:id/buffer..."` |
| `GET /api/geo/datasets/:id/routes` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/geo/datasets/:id/routes..."` |

### Media
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/media` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/media returns list"` |
| `GET /api/media/:id` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/media/:id returns media detail"` |
| `GET /api/media/:id/playback-state` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/media/:id/playback-state..."` |
| `PUT /api/media/:id/playback-state` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "PUT /api/media/:id/playback-state saves playback state"` |
| `GET /api/media/:id/subtitles` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/media/:id/subtitles returns subtitle tracks"` |

### System
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/health` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh`, `repo/tests/backend/integration/api.test.ts` | `test_status "GET /api/health returns 200"`; `GET /api/health returns ok...` |
| `GET /api/search` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/search?q=Jane returns results"` |
| `POST /api/checkpoint` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "POST /api/checkpoint saves checkpoint"` |
| `GET /api/checkpoint/latest` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/checkpoint/latest retrieves checkpoint"` |
| `GET /api/audit` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/audit returns audit entries"` |
| `GET /api/system/update-info` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | `test_status "GET /api/system/update-info returns info"` |
| `POST /api/system/apply-update` | No | Not covered | - | Declared in `repo/shared/api-contracts.ts` (`SYSTEM.APPLY_UPDATE`); no matching HTTP test |
| `POST /api/system/rollback` | No | Not covered | - | Declared in `repo/shared/api-contracts.ts` (`SYSTEM.ROLLBACK`); no matching HTTP test |

### Extra Route (not in shared contract)
| Endpoint | Covered | Type | Test files | Evidence |
|---|---:|---|---|---|
| `GET /api/tiles/:z/:x/:y` | Yes | True no-mock HTTP | `repo/tests/integration/api.sh` | tile section: `test_status "GET /api/tiles/0/0/0.png returns 404..."` |

## Mock Detection
- API-layer suites are no-mock HTTP.
- Mocking is present in lower-level tests:
  - `repo/tests/backend/routes/candidates.test.ts` (`jest.mock`, mocked query helpers)
  - `repo/tests/backend/routes/postings.test.ts` (`jest.mock`)
  - `repo/tests/backend/services/security.test.ts` (`jest.mock`)
  - `repo/tests/frontend/auth.service.spec.ts` (`HttpTestingController`)
  - `repo/tests/frontend/admin.component.spec.ts` (`jasmine.createSpyObj`)

## Coverage Summary
- Total endpoints: **115**
- Endpoints with HTTP tests: **111**
- Endpoints with true no-mock HTTP tests: **111**
- HTTP coverage: **96.5%**
- True API coverage: **96.5%**

## Unit Test Summary

### Backend Unit Tests
- Present: `repo/tests/backend/routes/*.test.ts`, `repo/tests/backend/services/*.test.ts`
- Covered areas: route authorization, candidate status logic, approval engine, scanner, encryption/security, access helpers.
- Important backend modules without direct unit suites: `repo/backend/src/routes/users.ts`, `repo/backend/src/routes/services.ts`, `repo/backend/src/routes/geo.ts`, `repo/backend/src/routes/media.ts`, `repo/backend/src/routes/system.ts`.

### Frontend Unit Tests (STRICT)
**Frontend unit tests: PRESENT**
- Files: `repo/tests/frontend/admin.component.spec.ts`, `repo/tests/frontend/auth.service.spec.ts`, `repo/tests/frontend/login.component.spec.ts`, `repo/tests/frontend/recruiting.component.spec.ts`
- Tooling evidence: Jasmine/Karma/TestBed (`repo/frontend/package.json`, `repo/frontend/angular.json`, `repo/frontend/karma.conf.js`)
- Direct component/service imports from `repo/frontend/src/app/...`.
- Important untested frontend feature areas: approvals, service-catalog, violations, geospatial, media-player.

### Cross-Layer Observation
- Coverage is multi-layer and balanced enough for this project shape: backend unit + no-mock API + frontend unit + E2E.

## API Observability Check
- Strong in `repo/tests/backend/integration/api.test.ts` (explicit request/response assertions).
- Moderate in `repo/tests/integration/api.sh` (many status checks; payload assertions present but inconsistent by endpoint).

## Test Quality & Sufficiency
- Main success/failure/auth/validation/authorization paths are broadly covered.
- Real E2E FE↔BE flows exist (`repo/tests/e2e/specs/auth.spec.ts`, `repo/tests/e2e/specs/projects.spec.ts`, `repo/tests/e2e/specs/rbac.spec.ts`).
- Notification-path integration checks rely on seeded `notification_tasks` inserted in `repo/backend/src/migrations/seed.ts`.
- Sufficiency limitations: 4 uncovered endpoints and mock-heavy lower-level backend unit tests.

## run_tests.sh Check
- `repo/run_tests.sh` exists.
- Main flow is Docker-first for backend tests, frontend unit tests, and E2E.
- Host tooling required: Docker/Compose, `bash`, `curl`, `jq`.
- No local Python/Node required for main test execution path.

## Tests Check
- Relevant categories for desktop+fullstack are present in meaningful form: API, integration, unit (backend+frontend), and E2E.
- Suite is confidence-building overall, with high real-boundary coverage.
- Still incomplete at a few endpoint edges.

## Test Coverage Score (0–100)
**92 / 100**

## Score Rationale
- Strong breadth/depth via true HTTP API coverage and real E2E, supported by unit suites.
- Deductions for uncovered endpoints and heavy mocking in backend unit layer.

## Key Gaps
- Uncovered: `DELETE /api/users/:id`, `DELETE /api/services/categories/:id`, `POST /api/system/apply-update`, `POST /api/system/rollback`.
- Several shell API checks remain status-centric rather than payload-contract-deep.

## Confidence & Assumptions
- Confidence: **Medium-High**.
- Static inspection only; no runtime execution.

---

# README Audit

## README Location
- Found at `repo/README.md`.

## Hard Gate Failures
- None.

## High Priority Issues
- None.

## Medium Priority Issues
- None material.

## Low Priority Issues
- None material.

## Hard Gate Review
- Formatting/readability: pass (`repo/README.md` structured with tables and code blocks).
- Startup instructions: pass (`docker compose up --build -d` present at `repo/README.md:22-25`).
- Access method: pass (explicit URLs at `repo/README.md:37-41`).
- Verification method: pass (API + UI checks at `repo/README.md:54-74`).
- Environment rules: pass for operational/test flow (Docker-first, no manual DB setup; local packaging called out as out-of-scope optional, no local install commands).
- Demo credentials: pass (all roles present at `repo/README.md:45-50`).

## README Verdict
**PASS**
