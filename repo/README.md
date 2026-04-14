# TalentOps Compliance & Service Desk

An enterprise-grade, fully offline desktop application that unifies recruiting project management, service catalog pricing, compliance/violation review, and multi-level approval workflows into a single keyboard-first workstation for HR operations teams.

## Prerequisites

- Docker 20.10+ and Docker Compose v2 (for development / CI)
- Node.js 18+ (for development and Electron packaging)
- PostgreSQL 16 with PostGIS (bundled in Docker for dev; bundled in MSI installer for production)
- Bash (for running integration tests)
- Electron 28+ and electron-builder 24+ (for desktop packaging only)

## Getting Started

### Quick Start with Docker

```bash
cd repo
docker compose up --build -d
```

This starts three services:
- **PostgreSQL + PostGIS** on port 5432 (auto-initializes database, runs migrations, seeds default data)
- **Backend API (Fastify)** on port 3000 (auto-runs migrations and seeds on startup)
- **Frontend (Angular/Nginx)** on port 4200 (proxies API requests to backend)

The application is fully functional after `docker compose up` with zero manual steps.

### Default Accounts

| Username | Password | Role |
|----------|----------|------|
| admin | admin | Administrator |
| recruiter | recruiter | Recruiter/Coordinator |
| reviewer | reviewer | Reviewer/Compliance Officer |
| approver | approver | Approver |

The admin account requires a password change on first login.

### Running Tests

**Integration tests** (requires running Docker services):
```bash
./run_tests.sh
```

The integration test script:
1. Waits for all services to be healthy
2. Tests 96 HTTP API endpoints
3. Covers: health check, authentication, CRUD operations, validation, authorization, status transitions, edge cases
4. Exits with code 0 on success, non-zero on failure

**Unit tests** (backend):
```bash
cd backend
npm install
npm test
```

Runs 13 test suites (117 tests) covering:
- Route-level authorization (candidates, postings, comments)
- Candidate status transition with required-field validation
- Approval engine logic (joint-sign, any-sign, write-back whitelisting)
- Encryption, violation scanning, project access control
- Attachment metadata extraction and quality checks
- Electron bridge wiring, installer path consistency

All test files are located in `tests/` at the repo root.

### Local Development

**Backend:**
```bash
cd backend
npm install
npm run dev
```

**Frontend:**
```bash
cd frontend
npm install
npm start
```

### Desktop Build (Signed MSI Installer)

The production deliverable is a signed Windows MSI installer built via Electron + electron-builder.

```bash
# 1. Build backend
cd backend && npm install && npm run build

# 2. Build frontend
cd ../frontend && npm install && npx ng build --configuration=production

# 3. Build Electron shell
cd ../electron && npm install && npm run build

# 4. Package signed MSI (requires WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD env vars)
npm run dist:msi
```

The MSI installer bundles PostgreSQL 16, runs migrations on first launch via
`installer/scripts/post-install.ps1`, and registers a system-tray autostart entry.

### Offline Update & Rollback

Update packages are signed `.tar.gz` archives importable from USB/disk:

```bash
# Create update package
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
├── tests/                             # All test files
│   ├── tsconfig.test.json            # TypeScript config for backend tests
│   ├── backend/
│   │   ├── routes/                   # Route-level behavior tests
│   │   │   ├── candidates.test.ts    # Candidate CRUD + object-level auth
│   │   │   ├── candidate-status.test.ts # Status transition + required fields
│   │   │   ├── comments.test.ts      # Entity-level comment authorization
│   │   │   └── postings.test.ts      # Posting create/delete auth
│   │   └── services/                 # Service-level unit tests
│   │       ├── approval-engine.test.ts
│   │       ├── attachment.service.test.ts
│   │       ├── candidate-action-routing.test.ts
│   │       ├── electron-bridge.test.ts
│   │       ├── encryption.service.test.ts
│   │       ├── installer-paths.test.ts
│   │       ├── project-access.test.ts
│   │       ├── security.test.ts
│   │       └── violation-scanner.test.ts
│   └── frontend/
│       └── admin.component.spec.ts   # Admin updater Angular TestBed spec
├── electron/                          # Electron desktop shell
│   ├── main.ts                        # App entry, multi-window management
│   ├── tray.ts                        # System tray badge (polls pending count)
│   ├── menus.ts                       # Context menus, global shortcuts
│   ├── updater.ts                     # Offline update + rollback mechanism
│   ├── checkpoint.ts                  # 30-second crash-recovery checkpoints
│   ├── preload.ts                     # IPC bridge to renderer
│   ├── package.json                   # Electron + electron-builder deps
│   ├── electron-builder.yml           # MSI/NSIS packaging config
│   └── tsconfig.json
├── installer/                         # MSI installer scripts
│   └── scripts/
│       ├── post-install.ps1           # PostgreSQL setup, migrations, shortcuts
│       └── pre-uninstall.ps1          # Cleanup on uninstall
├── shared/                            # Shared FE/BE API contract types
│   ├── api-contracts.ts               # Endpoint paths and response shapes
│   └── contract-utils.ts              # Contract utility functions
├── backend/                           # Fastify local server (Node.js/TypeScript)
│   ├── Dockerfile                     # Alpine-based multi-stage build
│   ├── package.json
│   ├── tsconfig.json
│   ├── jest.config.js                 # Points to tests/backend/
│   └── src/
│       ├── server.ts                  # Fastify app bootstrap, route registration
│       ├── config/                    # App configuration (ports, DB, JWT, etc.)
│       ├── plugins/
│       │   ├── database.ts            # PostgreSQL pool plugin
│       │   └── auth.ts                # JWT authentication plugin
│       ├── migrations/
│       │   ├── 001_initial.sql        # Full schema (20+ tables, PostGIS)
│       │   ├── run.ts                 # Migration runner
│       │   └── seed.ts               # Default data seeder
│       ├── models/                    # TypeScript interfaces for all entities
│       ├── services/
│       │   ├── encryption.service.ts  # AES-256-GCM field-level encryption
│       │   ├── violation-scanner.ts   # Rule-based violation detection
│       │   ├── approval-engine.ts     # Multi-level approval logic (joint/any-sign)
│       │   ├── notification.service.ts # Template rendering, export generation
│       │   ├── attachment.service.ts  # Upload validation, metadata extraction
│       │   ├── candidate-access.ts    # Object-level candidate authorization
│       │   ├── project-access.ts      # Object-level project/posting authorization
│       │   └── audit.service.ts       # Immutable audit trail logging
│       └── routes/
│           ├── auth.ts                # Login, logout, verify-password
│           ├── users.ts               # User CRUD (Admin)
│           ├── projects.ts            # Recruiting projects CRUD
│           ├── postings.ts            # Job postings CRUD
│           ├── candidates.ts          # Candidates with encrypted fields
│           ├── resumes.ts             # Resume version management (max 50)
│           ├── attachments.ts         # File upload with quality checks
│           ├── violations.ts          # Violation queue and rules
│           ├── services.ts            # Service categories & specifications
│           ├── pricing.ts             # Pricing rules (base/tiered/surcharge)
│           ├── capacity.ts            # Daily capacity plans
│           ├── credit-changes.ts      # Credit change requests
│           ├── approval-templates.ts  # Configurable approval chains
│           ├── approvals.ts           # Approval inbox and step processing
│           ├── notification-templates.ts
│           ├── notifications.ts       # In-app inbox, exports
│           ├── tags.ts                # Tag management
│           ├── comments.ts            # Entity comments
│           ├── geo.ts                 # Geospatial data import and analysis
│           ├── media.ts               # VOD playback state management
│           ├── search.ts              # Global search (Ctrl+K)
│           ├── checkpoint.ts          # Crash recovery checkpoints
│           ├── audit.ts               # Audit trail queries
│           └── system.ts              # Health check, update, rollback
├── frontend/                          # Angular 17 application
│   ├── Dockerfile                     # Multi-stage: build + nginx:alpine
│   ├── nginx.conf                     # SPA routing, API proxy
│   ├── package.json
│   ├── angular.json
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   └── src/
│       ├── app/
│       │   ├── app.module.ts          # Root module
│       │   ├── app-routing.module.ts  # All route definitions with guards
│       │   ├── app.component.ts       # Root layout with toolbar, sidenav
│       │   ├── core/                  # Auth service, guards, interceptors
│       │   ├── shared/                # Shared modules, pipes (localDate, localCurrency)
│       │   └── features/
│       │       ├── dashboard/         # Role-appropriate dashboard
│       │       ├── recruiting/        # Projects, postings, candidates
│       │       ├── candidate-detail/  # Componentized detail with blocks
│       │       ├── resume/            # Version history, structured editor
│       │       ├── violations/        # Review queue
│       │       ├── service-catalog/   # Categories, specs, pricing
│       │       ├── approvals/         # Approval inbox, chain progress
│       │       ├── notifications/     # In-app notification inbox
│       │       ├── geospatial/        # Leaflet map viewer
│       │       ├── media-player/      # HLS/DASH video player
│       │       └── admin/             # User, rules, templates, system update
│       └── assets/i18n/               # en.json, es.json (345 translation keys)
├── docker-compose.yml                 # PostgreSQL + Backend + Frontend
├── .dockerignore                      # Build context exclusions
├── run_tests.sh                       # Integration test suite (96 tests)
└── README.md
```

## Architecture

### Tech Stack
- **Backend**: Fastify (Node.js/TypeScript) — local application server
- **Frontend**: Angular 17 with Angular Material
- **Database**: PostgreSQL 16 with PostGIS extension
- **Auth**: JWT-based local authentication with object-level authorization
- **Encryption**: AES-256-GCM field-level encryption for sensitive data
- **i18n**: English + Spanish (345 keys) via @ngx-translate with localDate/localCurrency pipes
- **Maps**: Leaflet with PostGIS spatial queries
- **Video**: hls.js and dashjs for local HLS/DASH playback
- **Testing**: Jest (backend unit), Bash/curl (integration), Jasmine/Karma (frontend)

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
- **Bilingual**: Full English + Spanish UI translation (345 keys with exact parity)
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
- **Candidates**: `/api/postings/:id/candidates`, `/api/candidates/:id` (encrypted fields), `/api/candidates/:id/status` (status transitions)
- **Resumes**: `/api/candidates/:id/resumes` (version management)
- **Attachments**: `/api/candidates/:id/attachments` (upload with quality checks)
- **Violations**: `/api/violations` (review queue), `/api/violations/rules` (rule management), `/api/candidates/:id/scan`
- **Services**: `/api/services/categories`, `/api/services/specifications`, `/api/services/pricing`
- **Capacity**: `/api/services/specifications/:id/capacity`
- **Credit Changes**: `/api/credit-changes`
- **Approvals**: `/api/approval-templates`, `/api/approvals`
- **Notifications**: `/api/notifications`, `/api/notification-templates`
- **Tags**: `/api/tags`
- **Comments**: `/api/comments` (entity-level authorization)
- **Geospatial**: `/api/geo/datasets`, analysis endpoints
- **Media**: `/api/media`, playback state
- **System**: `/api/health`, `/api/search`, `/api/checkpoint`, `/api/audit`, `/api/system/update-info`
