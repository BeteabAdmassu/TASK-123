# TalentOps Compliance & Service Desk

Project Type: desktop, fullstack

An enterprise-grade, fully offline desktop application that unifies recruiting project management, service catalog pricing, compliance/violation review, and multi-level approval workflows into a single keyboard-first workstation for HR operations teams.

## Prerequisites

Operational usage and testing require only:

- Docker 20.10+ and Docker Compose v2
- Bash (for running `run_tests.sh`)
- curl and jq (for smoke tests and verification)

Desktop packaging only (optional):

- Node.js 18+
- Electron 28+ and electron-builder 24+

## Quick Start

```bash
cd repo
docker compose up --build -d
```

This starts three services:

- **PostgreSQL + PostGIS** on port 5432 — auto-initializes schema, runs migrations, seeds default data
- **Backend API (Fastify)** on port 3000 — auto-runs migrations and seeds on startup
- **Frontend (Angular/Nginx)** on port 4200 — proxies API requests to the backend

The application is fully functional after `docker compose up --build -d` with zero manual steps.

## Access

| Service | URL |
|---------|-----|
| Frontend | http://localhost:4200 |
| Backend API base | http://localhost:3000/api |
| Health endpoint | http://localhost:3000/api/health |

## Demo Accounts

| Username | Password | Role |
|----------|----------|------|
| admin | admin | Administrator |
| recruiter | recruiter | Recruiter/Coordinator |
| reviewer | reviewer | Reviewer/Compliance Officer |
| approver | approver | Approver |

The admin account requires a password change on first login.

## How to Verify It Works

**API check:**

```bash
curl -s http://localhost:3000/api/health | jq .status
# Expected: "ok"

curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' | jq .user.role
# Expected: "admin"
```

**UI check:**

1. Open http://localhost:4200 in a browser.
2. Log in with `admin` / `admin`.
3. Complete the required password change on first login.
4. You should land on `/dashboard` and see the app toolbar and sidenav.

## Running Tests

All test stages run inside Docker. The stack must already be up (`docker compose up --build -d`):

```bash
./run_tests.sh
```

The script runs four stages in order:

1. **Backend tests** — Jest unit and integration tests executed inside the running `backend` container. Covers service logic, route authorization, encryption, approval engine, and deep HTTP integration against the live database.
2. **API smoke tests** — shell/curl suite (`tests/integration/api.sh`) run on the host against `http://localhost:3000/api`. Covers endpoint reachability, auth flows, and key response contracts.
3. **Frontend unit tests** — Angular/Karma/Jasmine tests compiled and executed in a dedicated `frontend-test` Docker container (headless Chromium, no host browser needed).
4. **E2E tests** — Playwright tests executed in a dedicated `e2e` Docker container against the running frontend and backend stack.

The script waits for services to be healthy before running, exits 0 only when all four stages pass, and prints a clear `[PASS]`/`[FAIL]` line for each stage.

## Desktop Build (Signed MSI Installer)

> **Out of strict scope.** Producing the Windows MSI installer requires a Node.js 18+ and Electron 28+ toolchain on the build host and is entirely separate from running or testing the application. Refer to `electron/electron-builder.yml` and `installer/scripts/post-install.ps1` for packaging configuration.

The MSI installer bundles PostgreSQL 16, runs migrations on first launch via
`installer/scripts/post-install.ps1`, and registers a system-tray autostart entry.
Signing requires the `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` environment variables.

## Offline Update & Rollback

Update packages are signed `.tar.gz` archives importable from USB/disk:

```bash
tar -czf talentops-update-1.1.0.tar.gz -C dist/win-unpacked .
sha256sum talentops-update-1.1.0.tar.gz > talentops-update-1.1.0.tar.gz.sha256
```

Inside the app: **Admin → System → Check for Update** scans the configured
directory (or USB mount) for `talentops-update-*.tar.gz` files, verifies the
SHA-256 checksum, backs up the current version to `previous/`, and applies the
update. One-click rollback swaps `current/` and `previous/`.

## Project Structure

```
repo/
├── tests/
│   ├── tsconfig.test.json            # TypeScript config for backend tests
│   ├── backend/
│   │   ├── routes/                   # Route-level authorization tests (Jest)
│   │   │   ├── candidates.test.ts
│   │   │   ├── candidate-status.test.ts
│   │   │   ├── comments.test.ts
│   │   │   └── postings.test.ts
│   │   ├── services/                 # Service-level unit tests (Jest)
│   │   │   ├── approval-engine.test.ts
│   │   │   ├── attachment.service.test.ts
│   │   │   ├── candidate-action-routing.test.ts
│   │   │   ├── electron-bridge.test.ts
│   │   │   ├── encryption.service.test.ts
│   │   │   ├── installer-paths.test.ts
│   │   │   ├── project-access.test.ts
│   │   │   ├── security.test.ts
│   │   │   └── violation-scanner.test.ts
│   │   └── integration/              # Deep HTTP integration tests (Jest, real DB)
│   │       └── api.test.ts
│   ├── frontend/                     # Angular unit tests (Karma/Jasmine)
│   │   ├── admin.component.spec.ts
│   │   ├── auth.service.spec.ts
│   │   ├── login.component.spec.ts
│   │   └── recruiting.component.spec.ts
│   ├── e2e/                          # Playwright end-to-end tests
│   │   ├── Dockerfile
│   │   ├── playwright.config.ts
│   │   └── specs/
│   │       ├── auth.spec.ts
│   │       ├── projects.spec.ts
│   │       └── rbac.spec.ts
│   └── integration/
│       └── api.sh                    # Shell/curl smoke test suite
├── electron/                         # Electron desktop shell
│   ├── main.ts
│   ├── tray.ts
│   ├── menus.ts
│   ├── updater.ts
│   ├── checkpoint.ts
│   ├── preload.ts
│   ├── package.json
│   ├── electron-builder.yml
│   └── tsconfig.json
├── installer/
│   └── scripts/
│       ├── post-install.ps1
│       └── pre-uninstall.ps1
├── shared/
│   ├── api-contracts.ts
│   └── contract-utils.ts
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── jest.config.js
│   └── src/
│       ├── server.ts
│       ├── config/
│       ├── plugins/
│       │   ├── database.ts
│       │   └── auth.ts
│       ├── migrations/
│       │   ├── 001_initial.sql
│       │   ├── run.ts
│       │   └── seed.ts
│       ├── models/
│       ├── services/
│       │   ├── encryption.service.ts
│       │   ├── violation-scanner.ts
│       │   ├── approval-engine.ts
│       │   ├── notification.service.ts
│       │   ├── attachment.service.ts
│       │   ├── candidate-access.ts
│       │   ├── project-access.ts
│       │   └── audit.service.ts
│       └── routes/
│           ├── auth.ts
│           ├── users.ts
│           ├── projects.ts
│           ├── postings.ts
│           ├── candidates.ts
│           ├── resumes.ts
│           ├── attachments.ts
│           ├── violations.ts
│           ├── services.ts
│           ├── pricing.ts
│           ├── capacity.ts
│           ├── credit-changes.ts
│           ├── approval-templates.ts
│           ├── approvals.ts
│           ├── notification-templates.ts
│           ├── notifications.ts
│           ├── tags.ts
│           ├── comments.ts
│           ├── geo.ts
│           ├── media.ts
│           ├── search.ts
│           ├── checkpoint.ts
│           ├── audit.ts
│           └── system.ts
├── frontend/
│   ├── Dockerfile
│   ├── Dockerfile.test               # Headless Karma runner (ChromeHeadlessNoSandbox)
│   ├── nginx.conf
│   ├── package.json
│   ├── angular.json
│   ├── karma.conf.js
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   ├── tsconfig.spec.json
│   └── src/
│       ├── app/
│       │   ├── app.module.ts
│       │   ├── app-routing.module.ts
│       │   ├── app.component.ts
│       │   ├── core/
│       │   ├── shared/
│       │   └── features/
│       │       ├── dashboard/
│       │       ├── recruiting/
│       │       ├── candidate-detail/
│       │       ├── resume/
│       │       ├── violations/
│       │       ├── service-catalog/
│       │       ├── approvals/
│       │       ├── notifications/
│       │       ├── geospatial/
│       │       ├── media-player/
│       │       └── admin/
│       └── assets/i18n/
├── docker-compose.yml
├── .dockerignore
├── run_tests.sh
└── README.md
```

## Architecture

### Tech Stack

- **Backend**: Fastify (Node.js/TypeScript) — local application server
- **Frontend**: Angular 17 with Angular Material
- **Database**: PostgreSQL 16 with PostGIS extension
- **Auth**: JWT-based local authentication with object-level authorization
- **Encryption**: AES-256-GCM field-level encryption for sensitive data
- **i18n**: English + Spanish via @ngx-translate with localDate/localCurrency pipes
- **Maps**: Leaflet with PostGIS spatial queries
- **Video**: hls.js and dashjs for local HLS/DASH playback
- **Testing**: Jest (backend), Bash/curl (smoke), Jasmine/Karma (frontend unit), Playwright (E2E)

### Key Features

- **Multi-role access control**: Admin, Recruiter, Reviewer, Approver with object-level authorization
- **Keyboard-first UX**: Ctrl+K search, Ctrl+Enter save, Alt+N navigation
- **Encrypted sensitive fields**: SSN, DOB, compensation encrypted at rest (AES-256-GCM)
- **Violation detection**: Rule-based scanning for prohibited phrases, missing fields, duplicate patterns
- **Multi-level approvals**: Joint-sign (all must approve) or any-sign (first completes)
- **Candidate status gating**: Required-field validation blocks status advancement
- **Service catalog**: Configurable specs, pricing rules, capacity controls
- **Geospatial analytics**: CSV/GeoJSON import, spatial analysis, Leaflet visualization
- **VOD playback**: HLS/DASH with quality switching, subtitles, resume playback
- **Crash recovery**: 30-second checkpoints restore last state after restart
- **Bilingual**: Full English + Spanish UI translation
- **Offline update & rollback**: Admin UI wired to Electron updater with browser-safe fallback

### Database Schema

20+ tables covering:

- Users & authentication
- Recruiting projects, job postings, candidates
- Resume versions (max 50 retained, FIFO pruning)
- Attachments with quality checks (PDF/DOCX page count extraction)
- Violation rules and instances
- Service catalog: categories, attributes, specifications, pricing rules, capacity plans
- Credit changes with approval workflow
- Approval templates, requests, and steps
- Notifications with template rendering
- Geospatial datasets and features (PostGIS)
- Media assets and playback state
- Crash recovery checkpoints
- Immutable audit trail

## Environment Variables

All environment variables have defaults in `docker-compose.yml`. No `.env` file is needed.

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Backend server port |
| DB_HOST | db | PostgreSQL host |
| DB_PORT | 5432 | PostgreSQL port |
| DB_USER | talentops | Database user |
| DB_PASSWORD | talentops_secret | Database password |
| DB_NAME | talentops | Database name |
| JWT_SECRET | talentops-jwt-secret-... | JWT signing secret (warning logged if default used in production) |
| JWT_EXPIRES_IN | 24h | JWT expiration |
| ENCRYPTION_KEY | a1b2c3d4e5f6... | AES-256 master key (warning logged if default used in production) |
| LOG_LEVEL | info | Logging level |

## API Endpoints

The backend serves 80+ REST API endpoints across these domains:

- **Auth**: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/verify-password`
- **Users**: `/api/users` (Admin CRUD)
- **Projects**: `/api/projects` (CRUD with soft delete)
- **Postings**: `/api/projects/:id/postings`, `/api/postings/:id`
- **Candidates**: `/api/postings/:id/candidates`, `/api/candidates/:id` (encrypted fields), `/api/candidates/:id/status`
- **Resumes**: `/api/candidates/:id/resumes`
- **Attachments**: `/api/candidates/:id/attachments`
- **Violations**: `/api/violations`, `/api/violations/rules`, `/api/candidates/:id/scan`
- **Services**: `/api/services/categories`, `/api/services/specifications`, `/api/services/pricing`
- **Capacity**: `/api/services/specifications/:id/capacity`
- **Credit Changes**: `/api/credit-changes`
- **Approvals**: `/api/approval-templates`, `/api/approvals`
- **Notifications**: `/api/notifications`, `/api/notification-templates`
- **Tags**: `/api/tags`
- **Comments**: `/api/comments`
- **Geospatial**: `/api/geo/datasets`, analysis endpoints
- **Media**: `/api/media`, playback state
- **System**: `/api/health`, `/api/search`, `/api/checkpoint`, `/api/audit`, `/api/system/update-info`
