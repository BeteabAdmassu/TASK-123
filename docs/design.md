# Design Document

## Business Goal
Deliver an enterprise-grade, fully offline desktop application (TalentOps Compliance & Service Desk) that unifies recruiting project management, service catalog pricing, compliance/violation review, and multi-level approval workflows into a single keyboard-first workstation for HR operations teams.

## Core Requirements

### Desktop Shell & UX
1. Electron-based cross-platform desktop app targeting Windows 11
2. Multi-window UX: users can open Recruiting Project, Candidate Detail, and Approval Inbox windows simultaneously
3. Keyboard-first navigation with global shortcuts (Ctrl+K quick search, Ctrl+Enter save, Alt+N next record)
4. Right-click context menus on candidates/items ("Tag candidate," "Request missing materials," "Create approval task")
5. Deep clipboard integration for copying structured fields
6. System-tray presence that badges pending approvals and overdue tasks without push services
7. Componentized detail pages with configurable blocks (basic info, high-resolution images, stamp/verification notes, related works, cited sources)
8. Missing required fields show "Required" placeholder and prevent status changes until resolved
9. Bilingual support: English + Spanish, with localized dates (MM/DD/YYYY) and currency formatting ($)

### Recruiting & Candidate Management
10. Batch hiring projects with configurable resume templates and field rules
11. Structured resumes with version history — each save creates a new version, max 50 versions retained per resume
12. Attachment import (PDF/DOCX) with metadata extraction (file name, size, page count)
13. Attachment quality checks: required sections present, max 10 MB per file, allowed extensions only
14. Candidate intake and resume QA workflows for Recruiter/Coordinator role

### Violation Detection & Compliance
15. Rule-based local violation detection (prohibited phrases, missing EEOC disposition, duplicate SSN pattern flags)
16. Violations routed to a review queue with decision, comments, and immutable audit trail
17. Reviewer/Compliance Officer role for violation review and audit

### Service Catalog
18. Category/tag/attribute management for services
19. Configurable specifications: duration in 15-minute increments, headcount 1–20, tools/add-ons list capped at 30 items
20. Pricing rules: base price, tiered pricing thresholds, surcharges (e.g., "after-hours +$25.00")
21. Listing status lifecycle: Draft → Active → Paused → Retired
22. Capacity controls: daily order-taking volume per service with hard stop once reached

### Credit Change / Approval Workflow
23. Multi-level approvals with joint-sign (all must approve) or any-sign (first approval completes) modes
24. Required comments for rejection
25. Optional attachments up to 20 MB per approval
26. Final write-back only after the last approval step completes; partial approvals remain pending and visible in audit log
27. Approver role for multi-level credit change sign-off

### Notifications & Task Reminders
28. Fully local notification system: in-app inbox
29. Optional locally generated email/SMS as exportable files (no actual sending)
30. Template variables for notification content
31. Retries for rendering failures
32. Delivery receipts recorded as "generated/opened/acknowledged"

### Geospatial Analytics
33. Offline visualization of imported datasets (CSV/GeoJSON via file system, GPS device data via USB)
34. Administrative-region aggregation, grid/buffer analysis, POI density, route/trajectory display
35. Local spatial indexing and tile/layer rendering
36. Startup under 10 seconds, steady-state memory under 600 MB
37. Explicit resource disposal for media/map layers for long-running stability

### VOD Multi-Bitrate Playback
38. Local HLS/DASH asset playback with quality switching
39. Playback speed 0.5x–2.0x, subtitles (SRT/VTT), picture-in-picture
40. Resume playback persisted locally
41. Observable error codes (MEDIA_NOT_FOUND, SEGMENT_DECODE_FAIL) with automatic retries (3 attempts, 2/5/10s backoff)
42. Crash recovery via periodic checkpoints every 30 seconds — restores last viewed record, draft forms, and approval inbox state

### Security & Encryption
43. Sensitive fields (SSN, DOB, compensation) encrypted at rest
44. Sensitive fields masked in UI by default
45. Role-based reveal requiring re-entry of local password

### Roles & Permissions
46. Administrator: system setup, templates, permissions
47. Recruiter/Coordinator: job postings, candidate intake, resume QA
48. Reviewer/Compliance Officer: violation review and audit
49. Approver: multi-level credit change sign-off

### Installation & Updates
50. Signed .msi installer with bundled PostgreSQL
51. Offline update mechanism importing versioned update packages from disk/USB
52. One-click rollback to previous version

## Main User Flow

### Primary Flow: Recruiter Processing a Candidate
1. User launches the app from desktop → system tray icon appears, main window loads with dashboard
2. User logs in with local credentials → sees role-appropriate dashboard (Recruiter view)
3. User opens a Recruiting Project window (Ctrl+K → search project name) → sees batch hiring project with job postings
4. User clicks a Job Posting → opens Candidate list for that posting
5. User clicks "Add Candidate" or imports candidate data → Candidate Detail window opens
6. User fills structured resume form (configurable blocks) → required fields enforced with "Required" placeholder
7. User attaches PDF/DOCX resume → system extracts metadata, runs quality checks (size, extensions, required sections)
8. User saves (Ctrl+Enter) → new resume version created, version counter increments
9. System runs local violation detection → flags any issues (prohibited phrases, missing EEOC disposition, duplicate SSN)
10. If violations found → routed to Reviewer/Compliance Officer's review queue
11. Reviewer opens violation in review queue → makes decision, adds comments → immutable audit trail recorded
12. If candidate requires approval (e.g., credit change) → Recruiter right-clicks → "Create approval task"
13. Approval request enters Approver's Approval Inbox → multi-level sign-off proceeds (joint or any-sign)
14. On final approval → write-back applied, candidate status updated
15. Throughout: system-tray badges update for pending approvals and overdue tasks

### Secondary Flow: Service Catalog Management
1. Administrator opens Service Catalog → manages categories, tags, attributes
2. Creates service with specs (duration, headcount, tools/add-ons) → sets pricing rules and capacity
3. Service moves through Draft → Active lifecycle
4. Capacity controls enforce daily order limits with hard stop

## Tech Stack
- **Desktop Shell**: Electron (cross-platform, Windows 11 primary target) — specified in prompt
- **Frontend**: Angular (TypeScript) — specified in prompt
- **Backend/API Layer**: Fastify (Node.js) running as local application server — specified in prompt
- **Database**: PostgreSQL (bundled local installation) — specified in prompt
- **Geospatial**: Leaflet or OpenLayers for map rendering, Turf.js for spatial analysis, local MBTiles/vector tiles
- **Video Playback**: hls.js for HLS, dashjs for DASH, with custom Angular wrapper component
- **Encryption**: Node.js `crypto` module (AES-256-GCM for field-level encryption at rest)
- **i18n**: Angular i18n with `@angular/localize` for English + Spanish
- **Installer**: electron-builder producing signed .msi via WiX toolset
- **Testing**: Jest (backend unit/integration), Jasmine + Karma or Jest (Angular), Playwright (E2E)

## Database Schema

### Core Identity & Auth
```
Users
  id              UUID PK
  username        VARCHAR(100) UNIQUE NOT NULL
  password_hash   VARCHAR(255) NOT NULL
  role            ENUM('admin','recruiter','reviewer','approver') NOT NULL
  locale          VARCHAR(10) DEFAULT 'en'
  created_at      TIMESTAMPTZ NOT NULL
  updated_at      TIMESTAMPTZ NOT NULL
  INDEX idx_users_username (username)
  INDEX idx_users_role (role)
```

### Recruiting Domain
```
RecruitingProject
  id              UUID PK
  title           VARCHAR(255) NOT NULL
  description     TEXT
  status          ENUM('draft','active','completed','archived') NOT NULL DEFAULT 'draft'
  created_by      UUID FK → Users.id
  archived_at     TIMESTAMPTZ            -- soft delete
  created_at      TIMESTAMPTZ NOT NULL
  updated_at      TIMESTAMPTZ NOT NULL
  INDEX idx_rp_status (status)
  INDEX idx_rp_created_by (created_by)

JobPosting
  id              UUID PK
  project_id      UUID FK → RecruitingProject.id ON DELETE CASCADE
  title           VARCHAR(255) NOT NULL
  description     TEXT
  requirements    JSONB
  field_rules     JSONB          -- configurable resume template/field rules
  status          ENUM('draft','open','closed') NOT NULL DEFAULT 'draft'
  archived_at     TIMESTAMPTZ            -- soft delete
  created_at      TIMESTAMPTZ NOT NULL
  updated_at      TIMESTAMPTZ NOT NULL
  INDEX idx_jp_project (project_id)
  INDEX idx_jp_status (status)

Candidate
  id              UUID PK
  job_posting_id  UUID FK → JobPosting.id
  first_name      VARCHAR(100) NOT NULL
  last_name       VARCHAR(100) NOT NULL
  email           VARCHAR(255)
  phone           VARCHAR(50)
  ssn_encrypted   BYTEA           -- AES-256-GCM encrypted
  dob_encrypted   BYTEA           -- AES-256-GCM encrypted
  compensation_encrypted BYTEA    -- AES-256-GCM encrypted
  eeoc_disposition VARCHAR(100)
  status          ENUM('intake','screening','review','approved','rejected') NOT NULL DEFAULT 'intake'
  archived_at     TIMESTAMPTZ            -- soft delete
  created_at      TIMESTAMPTZ NOT NULL
  updated_at      TIMESTAMPTZ NOT NULL
  INDEX idx_cand_posting (job_posting_id)
  INDEX idx_cand_status (status)

ResumeVersion
  id              UUID PK
  candidate_id    UUID FK → Candidate.id ON DELETE CASCADE
  version_number  INTEGER NOT NULL
  content         JSONB NOT NULL   -- structured resume blocks
  created_by      UUID FK → Users.id
  created_at      TIMESTAMPTZ NOT NULL
  UNIQUE (candidate_id, version_number)
  INDEX idx_rv_candidate (candidate_id)

Attachment
  id              UUID PK
  candidate_id    UUID FK → Candidate.id ON DELETE CASCADE
  file_name       VARCHAR(255) NOT NULL
  file_path       VARCHAR(500) NOT NULL
  file_size       INTEGER NOT NULL        -- bytes, max 10485760
  file_type       VARCHAR(10) NOT NULL    -- pdf, docx
  page_count      INTEGER
  quality_status  ENUM('pending','passed','failed') DEFAULT 'pending'
  quality_errors  JSONB
  created_at      TIMESTAMPTZ NOT NULL
  INDEX idx_att_candidate (candidate_id)

Tag
  id              UUID PK
  name            VARCHAR(100) UNIQUE NOT NULL
  color           VARCHAR(7)
  INDEX idx_tag_name (name)

CandidateTag  (junction)
  candidate_id    UUID FK → Candidate.id ON DELETE CASCADE
  tag_id          UUID FK → Tag.id ON DELETE CASCADE
  PRIMARY KEY (candidate_id, tag_id)

ServiceTag  (junction — tags shared with service catalog per prompt)
  spec_id         UUID FK → ServiceSpecification.id ON DELETE CASCADE
  tag_id          UUID FK → Tag.id ON DELETE CASCADE
  PRIMARY KEY (spec_id, tag_id)
```

### Violation & Compliance
```
ViolationRule
  id              UUID PK
  rule_type       ENUM('prohibited_phrase','missing_field','duplicate_pattern','custom') NOT NULL
  rule_config     JSONB NOT NULL   -- e.g., {"phrases": ["illegal term"]} or {"field": "eeoc_disposition"}
  severity        ENUM('warning','error','critical') NOT NULL
  is_active       BOOLEAN DEFAULT true
  created_at      TIMESTAMPTZ NOT NULL

ViolationInstance
  id              UUID PK
  candidate_id    UUID FK → Candidate.id
  rule_id         UUID FK → ViolationRule.id
  details         JSONB NOT NULL
  status          ENUM('pending','reviewed','dismissed','escalated') DEFAULT 'pending'
  reviewed_by     UUID FK → Users.id
  decision        VARCHAR(50)
  review_comment  TEXT
  reviewed_at     TIMESTAMPTZ
  created_at      TIMESTAMPTZ NOT NULL
  INDEX idx_vi_status (status)
  INDEX idx_vi_candidate (candidate_id)

AuditTrail
  id              UUID PK
  entity_type     VARCHAR(100) NOT NULL
  entity_id       UUID NOT NULL
  action          VARCHAR(100) NOT NULL
  actor_id        UUID FK → Users.id
  before_state    JSONB
  after_state     JSONB
  metadata        JSONB
  created_at      TIMESTAMPTZ NOT NULL
  INDEX idx_audit_entity (entity_type, entity_id)
  INDEX idx_audit_actor (actor_id)
  INDEX idx_audit_created (created_at)
  -- This table is INSERT-ONLY (immutable)
```

### Service Catalog
```
ServiceCategory
  id              UUID PK
  name            VARCHAR(255) NOT NULL
  description     TEXT
  parent_id       UUID FK → ServiceCategory.id   -- hierarchical
  created_at      TIMESTAMPTZ NOT NULL
  updated_at      TIMESTAMPTZ NOT NULL
  INDEX idx_sc_parent (parent_id)

ServiceAttribute
  id              UUID PK
  category_id     UUID FK → ServiceCategory.id ON DELETE CASCADE
  name            VARCHAR(255) NOT NULL
  data_type       VARCHAR(50) NOT NULL
  is_required     BOOLEAN DEFAULT false

ServiceSpecification
  id              UUID PK
  category_id     UUID FK → ServiceCategory.id
  name            VARCHAR(255) NOT NULL
  description     TEXT
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes % 15 = 0)
  headcount       INTEGER NOT NULL CHECK (headcount BETWEEN 1 AND 20)
  tools_addons    JSONB DEFAULT '[]'   -- max 30 items enforced at app level
  status          ENUM('draft','active','paused','retired') NOT NULL DEFAULT 'draft'
  daily_capacity  INTEGER              -- default daily hard stop; overridden by CapacityPlan per-date
  archived_at     TIMESTAMPTZ            -- soft delete
  created_at      TIMESTAMPTZ NOT NULL
  updated_at      TIMESTAMPTZ NOT NULL
  INDEX idx_ss_status (status)
  INDEX idx_ss_category (category_id)

PricingRule
  id              UUID PK
  spec_id         UUID FK → ServiceSpecification.id ON DELETE CASCADE
  rule_type       ENUM('base','tiered','surcharge') NOT NULL
  base_price      DECIMAL(10,2)
  tier_config     JSONB          -- [{min_qty, max_qty, unit_price}]
  surcharge_label VARCHAR(255)   -- e.g., "after-hours"
  surcharge_amount DECIMAL(10,2)
  created_at      TIMESTAMPTZ NOT NULL
  INDEX idx_pr_spec (spec_id)

CapacityPlan
  id              UUID PK
  spec_id         UUID FK → ServiceSpecification.id
  date            DATE NOT NULL
  max_volume      INTEGER NOT NULL
  current_volume  INTEGER DEFAULT 0
  is_stopped      BOOLEAN DEFAULT false
  UNIQUE (spec_id, date)
  INDEX idx_cp_date (date)
```

### Credit Change
```
CreditChange
  id              UUID PK
  entity_type     VARCHAR(100) NOT NULL   -- e.g., 'service_spec', 'candidate'
  entity_id       UUID NOT NULL
  amount          DECIMAL(12,2) NOT NULL
  reason          TEXT NOT NULL
  requested_by    UUID FK → Users.id
  status          ENUM('pending_approval','approved','rejected') DEFAULT 'pending_approval'
  created_at      TIMESTAMPTZ NOT NULL
  updated_at      TIMESTAMPTZ NOT NULL
  INDEX idx_cc_entity (entity_type, entity_id)
  INDEX idx_cc_status (status)
```

### Approval Workflow
```
ApprovalTemplate
  id              UUID PK
  name            VARCHAR(255) NOT NULL
  description     TEXT
  approval_mode   ENUM('joint','any') NOT NULL   -- joint = all must approve, any = first completes
  is_active       BOOLEAN DEFAULT true
  created_by      UUID FK → Users.id
  created_at      TIMESTAMPTZ NOT NULL
  updated_at      TIMESTAMPTZ NOT NULL

ApprovalTemplateStep
  id              UUID PK
  template_id     UUID FK → ApprovalTemplate.id ON DELETE CASCADE
  step_order      INTEGER NOT NULL
  approver_id     UUID FK → Users.id
  created_at      TIMESTAMPTZ NOT NULL
  UNIQUE (template_id, step_order)
  INDEX idx_ats_template (template_id)

ApprovalRequest
  id              UUID PK
  template_id     UUID FK → ApprovalTemplate.id  -- template used to instantiate steps
  entity_type     VARCHAR(100) NOT NULL   -- e.g., 'credit_change', 'candidate'
  entity_id       UUID NOT NULL
  requested_by    UUID FK → Users.id
  approval_mode   ENUM('joint','any') NOT NULL   -- copied from template at creation time
  status          ENUM('pending','approved','rejected') DEFAULT 'pending'
  final_write_back JSONB                  -- changes to apply on final approval
  created_at      TIMESTAMPTZ NOT NULL
  updated_at      TIMESTAMPTZ NOT NULL
  INDEX idx_ar_status (status)
  INDEX idx_ar_entity (entity_type, entity_id)

ApprovalStep
  id              UUID PK
  request_id      UUID FK → ApprovalRequest.id ON DELETE CASCADE
  step_order      INTEGER NOT NULL
  approver_id     UUID FK → Users.id
  status          ENUM('pending','approved','rejected') DEFAULT 'pending'
  comment         TEXT            -- required on rejection
  attachment_path VARCHAR(500)   -- optional, max 20 MB
  attachment_size INTEGER
  decided_at      TIMESTAMPTZ
  created_at      TIMESTAMPTZ NOT NULL
  INDEX idx_as_request (request_id)
  INDEX idx_as_approver (approver_id)
  INDEX idx_as_status (status)
```

### Notifications
```
NotificationTemplate
  id              UUID PK
  template_key    VARCHAR(100) UNIQUE NOT NULL  -- e.g., 'approval_requested', 'violation_flagged'
  subject         VARCHAR(255) NOT NULL         -- supports {{variable}} placeholders
  body            TEXT NOT NULL                  -- supports {{variable}} placeholders
  channel         ENUM('in_app','email_export','sms_export') NOT NULL
  is_active       BOOLEAN DEFAULT true
  created_at      TIMESTAMPTZ NOT NULL
  updated_at      TIMESTAMPTZ NOT NULL
  INDEX idx_ntpl_key (template_key)

NotificationTask
  id              UUID PK
  recipient_id    UUID FK → Users.id
  type            ENUM('in_app','email_export','sms_export') NOT NULL
  template_key    VARCHAR(100) NOT NULL
  template_vars   JSONB NOT NULL
  rendered_content TEXT
  status          ENUM('pending','generated','opened','acknowledged','failed') DEFAULT 'pending'
  retry_count     INTEGER DEFAULT 0
  max_retries     INTEGER DEFAULT 3
  export_path     VARCHAR(500)    -- path to generated file for email/sms
  created_at      TIMESTAMPTZ NOT NULL
  updated_at      TIMESTAMPTZ NOT NULL
  INDEX idx_nt_recipient (recipient_id)
  INDEX idx_nt_status (status)

Comment
  id              UUID PK
  entity_type     VARCHAR(100) NOT NULL
  entity_id       UUID NOT NULL
  author_id       UUID FK → Users.id
  body            TEXT NOT NULL
  created_at      TIMESTAMPTZ NOT NULL
  INDEX idx_comment_entity (entity_type, entity_id)
```

### Geospatial
```
GeoDataset
  id              UUID PK
  name            VARCHAR(255) NOT NULL
  source_type     ENUM('csv','geojson','gps') NOT NULL
  file_path       VARCHAR(500) NOT NULL
  import_status   ENUM('pending','processing','complete','error') DEFAULT 'pending'
  feature_count   INTEGER
  bounds          JSONB          -- bounding box
  created_at      TIMESTAMPTZ NOT NULL
  INDEX idx_gd_status (import_status)

GeoFeature
  id              UUID PK
  dataset_id      UUID FK → GeoDataset.id ON DELETE CASCADE
  geometry        GEOMETRY(Geometry, 4326)   -- PostGIS
  properties      JSONB
  INDEX idx_gf_dataset (dataset_id)
  SPATIAL INDEX idx_gf_geom (geometry)
```

### Crash Recovery & Checkpoints
```
AppCheckpoint
  id              UUID PK
  user_id         UUID FK → Users.id
  checkpoint_data JSONB NOT NULL   -- last viewed record, draft forms, inbox state
  created_at      TIMESTAMPTZ NOT NULL
  INDEX idx_ckpt_user (user_id)
  -- Keep only latest per user; old checkpoints pruned on write
```

### Media / VOD
```
MediaAsset
  id              UUID PK
  title           VARCHAR(255) NOT NULL
  file_path       VARCHAR(500) NOT NULL
  format          ENUM('hls','dash') NOT NULL
  duration_seconds DECIMAL(10,2)
  subtitle_paths  JSONB DEFAULT '[]'    -- [{lang, format, path}]
  created_at      TIMESTAMPTZ NOT NULL

PlaybackState
  id              UUID PK
  user_id         UUID FK → Users.id
  asset_id        UUID FK → MediaAsset.id
  position_seconds DECIMAL(10,2) NOT NULL DEFAULT 0
  playback_speed  DECIMAL(3,1) DEFAULT 1.0
  selected_quality VARCHAR(50)
  updated_at      TIMESTAMPTZ NOT NULL
  UNIQUE (user_id, asset_id)
```

## API Endpoints

All endpoints are served by the local Fastify server (localhost). Auth is local session/token based.

### Auth & Users
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/login | No | Local login, returns JWT |
| POST | /api/auth/logout | Yes | Invalidate session |
| GET | /api/auth/me | Yes | Current user profile |
| POST | /api/auth/verify-password | Yes | Re-verify password for sensitive field reveal |
| GET | /api/users | Admin | List all users |
| POST | /api/users | Admin | Create user account |
| PUT | /api/users/:id | Admin | Update user role/permissions |
| DELETE | /api/users/:id | Admin | Deactivate user |

### Recruiting Projects
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/projects | Yes | List recruiting projects (paginated) |
| POST | /api/projects | Recruiter+ | Create recruiting project |
| GET | /api/projects/:id | Yes | Get project detail |
| PUT | /api/projects/:id | Recruiter+ | Update project |
| DELETE | /api/projects/:id | Admin | Archive project |

### Job Postings
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/projects/:projectId/postings | Yes | List postings for project |
| POST | /api/projects/:projectId/postings | Recruiter+ | Create job posting |
| GET | /api/postings/:id | Yes | Get posting detail |
| PUT | /api/postings/:id | Recruiter+ | Update posting |
| DELETE | /api/postings/:id | Recruiter+ | Close/delete posting |

### Candidates
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/postings/:postingId/candidates | Yes | List candidates (paginated) |
| POST | /api/postings/:postingId/candidates | Recruiter+ | Create candidate |
| GET | /api/candidates/:id | Yes | Get candidate detail (masked sensitive fields) |
| PUT | /api/candidates/:id | Recruiter+ | Update candidate |
| POST | /api/candidates/:id/reveal | Yes | Reveal sensitive field (requires password re-entry) |
| POST | /api/candidates/:id/tags | Recruiter+ | Add tag to candidate |
| DELETE | /api/candidates/:id/tags/:tagId | Recruiter+ | Remove tag from candidate |
| POST | /api/candidates/:id/request-materials | Recruiter+ | Request missing materials |

### Resume Versions
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/candidates/:candidateId/resumes | Yes | List resume versions |
| POST | /api/candidates/:candidateId/resumes | Recruiter+ | Save new resume version |
| GET | /api/resumes/:id | Yes | Get specific resume version |
| GET | /api/candidates/:candidateId/resumes/latest | Yes | Get latest resume version |

### Attachments
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/candidates/:candidateId/attachments | Yes | List attachments |
| POST | /api/candidates/:candidateId/attachments | Recruiter+ | Upload attachment (max 10MB) |
| GET | /api/attachments/:id | Yes | Get attachment metadata |
| GET | /api/attachments/:id/download | Yes | Download attachment file |
| DELETE | /api/attachments/:id | Recruiter+ | Remove attachment |

### Violations & Compliance
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/violations | Reviewer+ | List violation queue (filterable) |
| GET | /api/violations/:id | Reviewer+ | Get violation detail |
| PUT | /api/violations/:id/review | Reviewer | Submit review decision + comments |
| GET | /api/violations/rules | Admin | List violation rules |
| POST | /api/violations/rules | Admin | Create violation rule |
| PUT | /api/violations/rules/:id | Admin | Update violation rule |
| POST | /api/candidates/:id/scan | Recruiter+ | Trigger violation scan for candidate |

### Service Catalog
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/services/categories | Yes | List service categories |
| POST | /api/services/categories | Admin | Create category |
| PUT | /api/services/categories/:id | Admin | Update category |
| DELETE | /api/services/categories/:id | Admin | Delete category |
| GET | /api/services/categories/:id/attributes | Yes | List attributes for category |
| POST | /api/services/categories/:id/attributes | Admin | Create attribute |
| GET | /api/services/specifications | Yes | List service specifications (paginated) |
| POST | /api/services/specifications | Admin | Create specification |
| GET | /api/services/specifications/:id | Yes | Get specification detail |
| PUT | /api/services/specifications/:id | Admin | Update specification |
| PUT | /api/services/specifications/:id/status | Admin | Change listing status |
| GET | /api/services/specifications/:id/pricing | Yes | List pricing rules |
| POST | /api/services/specifications/:id/pricing | Admin | Create pricing rule |
| PUT | /api/services/pricing/:id | Admin | Update pricing rule |
| DELETE | /api/services/pricing/:id | Admin | Delete pricing rule |
| POST | /api/services/specifications/:id/tags | Admin | Add tag to specification |
| DELETE | /api/services/specifications/:id/tags/:tagId | Admin | Remove tag from specification |

### Capacity
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/services/specifications/:id/capacity | Yes | Get capacity plan |
| POST | /api/services/specifications/:id/capacity | Admin | Set daily capacity |
| PUT | /api/services/capacity/:id | Admin | Update capacity plan |

### Credit Changes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/credit-changes | Yes | List credit change requests |
| POST | /api/credit-changes | Recruiter+ | Create credit change request |
| GET | /api/credit-changes/:id | Yes | Get credit change detail |

### Approval Templates
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/approval-templates | Admin | List approval templates |
| POST | /api/approval-templates | Admin | Create approval template with steps |
| GET | /api/approval-templates/:id | Admin | Get template detail with steps |
| PUT | /api/approval-templates/:id | Admin | Update template |
| DELETE | /api/approval-templates/:id | Admin | Deactivate template |

### Approvals
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/approvals | Yes | List approval requests (inbox, filtered by role) |
| POST | /api/approvals | Recruiter+ | Create approval request (from template) |
| GET | /api/approvals/:id | Yes | Get approval request with steps |
| PUT | /api/approvals/:id/steps/:stepId | Approver | Approve or reject a step |
| GET | /api/approvals/:id/audit | Yes | Get audit trail for approval |

### Notification Templates
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/notification-templates | Admin | List notification templates |
| POST | /api/notification-templates | Admin | Create notification template |
| PUT | /api/notification-templates/:id | Admin | Update notification template |
| DELETE | /api/notification-templates/:id | Admin | Deactivate template |

### Notifications
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/notifications | Yes | List user's notifications (inbox) |
| PUT | /api/notifications/:id/read | Yes | Mark notification as opened |
| PUT | /api/notifications/:id/acknowledge | Yes | Mark notification as acknowledged |
| GET | /api/notifications/pending-count | Yes | Get count for tray badge |
| POST | /api/notifications/export/:id | Yes | Generate email/SMS export file |

### Tags
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/tags | Yes | List all tags |
| POST | /api/tags | Recruiter+ | Create tag |
| PUT | /api/tags/:id | Recruiter+ | Update tag |
| DELETE | /api/tags/:id | Admin | Delete tag |

### Comments
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/comments?entityType=X&entityId=Y | Yes | List comments for an entity |
| POST | /api/comments | Yes | Create comment on an entity |
| DELETE | /api/comments/:id | Yes | Delete own comment (or Admin) |

### Geospatial
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/geo/datasets | Yes | List imported datasets |
| POST | /api/geo/datasets/import | Yes | Import CSV/GeoJSON/GPS file |
| GET | /api/geo/datasets/:id | Yes | Get dataset metadata |
| DELETE | /api/geo/datasets/:id | Yes | Remove dataset |
| GET | /api/geo/datasets/:id/features | Yes | Get features (paginated, bbox filter) |
| GET | /api/geo/datasets/:id/aggregate | Yes | Administrative-region aggregation |
| GET | /api/geo/datasets/:id/density | Yes | POI density analysis |
| GET | /api/geo/datasets/:id/buffer | Yes | Grid/buffer analysis |
| GET | /api/geo/datasets/:id/routes | Yes | Route/trajectory display |

### Media / VOD
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/media | Yes | List local media assets |
| GET | /api/media/:id | Yes | Get media detail + manifest path |
| GET | /api/media/:id/playback-state | Yes | Get resume position |
| PUT | /api/media/:id/playback-state | Yes | Save playback position/speed/quality |
| GET | /api/media/:id/subtitles | Yes | List available subtitle tracks |

### System
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/health | No | Health check |
| GET | /api/search | Yes | Global search (Ctrl+K) |
| POST | /api/checkpoint | Yes | Save crash recovery checkpoint |
| GET | /api/checkpoint/latest | Yes | Get latest checkpoint for recovery |
| GET | /api/audit | Admin | Query audit trail |
| GET | /api/system/update-info | Admin | Check update package on disk/USB |
| POST | /api/system/apply-update | Admin | Apply versioned update package |
| POST | /api/system/rollback | Admin | Rollback to previous version |

## Implied Requirements

- **Error handling** on all API endpoints returning proper HTTP status codes (400, 401, 403, 404, 409, 413, 500)
- **Input validation** on all forms and API inputs (Fastify JSON schema validation)
- **Loading/empty/error/success states** on all Angular components
- **Auth middleware** on all protected routes checking JWT and role
- **Object-level authorization** — users access only resources within their role scope
- **Health check** endpoint at `/api/health`
- **Structured logging** — JSON-formatted logs with correlation IDs, written to local log files
- **Docker support** with auto-migration for development/CI (production is native .msi install)
- **Integration tests** runnable via `run_tests.sh`
- **Database migrations** — versioned schema migrations (e.g., via node-pg-migrate or Knex migrations)
- **Request/response CORS** not needed (local app) but proper Content-Security-Policy headers for Electron
- **Pagination** on all list endpoints (default page size, offset/cursor)
- **Optimistic locking** or version checks for concurrent edits on shared entities
- **Graceful shutdown** — Fastify server and PostgreSQL connections close cleanly on app exit
- **File system cleanup** — orphaned attachments and exported notification files pruned periodically
- **PostGIS extension** enabled for geospatial queries
- **Memory profiling guards** — map/media layers explicitly disposed to stay under 600 MB

## Scope Boundary

Do NOT build these unless explicitly requested:
- No cloud deployment or remote server — this is a fully offline desktop application
- No real email or SMS sending — only generate exportable files
- No push notification services — system tray badges are local polling only
- No user self-registration — Administrator creates accounts
- No OAuth/SSO/LDAP integration — local password auth only
- No admin panel as a separate web app — admin features are within the desktop app
- No payment or billing integration
- No CI/CD pipeline — installer is built manually or via local build script
- No mobile or web client — desktop only
- No real-time collaboration or WebSocket sync between multiple users/workstations
- No OCR or AI-based resume parsing — metadata extraction is basic (file name, size, page count)
- No external API integrations (job boards, background check services, etc.)
- No report generation/export beyond notification file generation
- No automated email verification or password reset flow
- No multi-tenant architecture — single organization per install

## Project Structure

```
repo/
├── electron/                          # Electron main process
│   ├── main.ts                        # App entry point, window management
│   ├── tray.ts                        # System tray with badge logic
│   ├── menus.ts                       # Context menus, global shortcuts
│   ├── updater.ts                     # Offline update mechanism + rollback
│   ├── checkpoint.ts                  # Crash recovery checkpoint manager
│   └── preload.ts                     # Preload script for IPC bridge
├── frontend/                          # Angular application
│   ├── angular.json
│   ├── package.json
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/                  # Auth, guards, interceptors, services
│   │   │   │   ├── auth/
│   │   │   │   ├── guards/
│   │   │   │   ├── interceptors/
│   │   │   │   └── services/
│   │   │   ├── shared/                # Shared components, pipes, directives
│   │   │   │   ├── components/        # Configurable block components
│   │   │   │   ├── pipes/             # Date/currency locale pipes
│   │   │   │   └── directives/        # Keyboard shortcut directives
│   │   │   ├── features/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── recruiting/        # Projects, postings, candidates
│   │   │   │   ├── candidate-detail/  # Multi-block candidate view
│   │   │   │   ├── resume/            # Version history, structured editor
│   │   │   │   ├── violations/        # Review queue
│   │   │   │   ├── service-catalog/   # Categories, specs, pricing
│   │   │   │   ├── approvals/         # Inbox, multi-level workflow
│   │   │   │   ├── notifications/     # In-app inbox
│   │   │   │   ├── geospatial/        # Map viewer, dataset import
│   │   │   │   ├── media-player/      # VOD playback
│   │   │   │   └── admin/             # User management, rules, templates
│   │   │   └── app.module.ts
│   │   ├── assets/
│   │   │   └── i18n/                  # en.json, es.json
│   │   ├── environments/
│   │   └── styles/
│   └── tsconfig.json
├── backend/                           # Fastify local server
│   ├── package.json
│   ├── src/
│   │   ├── server.ts                  # Fastify app bootstrap
│   │   ├── config/                    # App configuration
│   │   ├── plugins/                   # Fastify plugins (auth, db, etc.)
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── users.ts
│   │   │   ├── projects.ts
│   │   │   ├── postings.ts
│   │   │   ├── candidates.ts
│   │   │   ├── resumes.ts
│   │   │   ├── attachments.ts
│   │   │   ├── violations.ts
│   │   │   ├── services.ts
│   │   │   ├── pricing.ts
│   │   │   ├── capacity.ts
│   │   │   ├── credit-changes.ts
│   │   │   ├── approval-templates.ts
│   │   │   ├── approvals.ts
│   │   │   ├── notification-templates.ts
│   │   │   ├── notifications.ts
│   │   │   ├── tags.ts
│   │   │   ├── comments.ts
│   │   │   ├── geo.ts
│   │   │   ├── media.ts
│   │   │   ├── search.ts
│   │   │   ├── checkpoint.ts
│   │   │   ├── audit.ts
│   │   │   └── system.ts
│   │   ├── services/                  # Business logic layer
│   │   │   ├── auth.service.ts
│   │   │   ├── candidate.service.ts
│   │   │   ├── violation-scanner.ts   # Rule-based violation detection
│   │   │   ├── approval-engine.ts     # Multi-level approval logic
│   │   │   ├── encryption.service.ts  # Field-level encryption
│   │   │   ├── attachment.service.ts  # Upload, metadata extraction, QA
│   │   │   ├── notification.service.ts
│   │   │   ├── geo.service.ts         # Spatial indexing, analysis
│   │   │   └── media.service.ts
│   │   ├── models/                    # TypeScript interfaces / types
│   │   ├── schemas/                   # Fastify JSON validation schemas
│   │   ├── middleware/                # Auth, role-check hooks
│   │   └── migrations/               # Database migration files
│   └── tsconfig.json
├── installer/                         # MSI build scripts
│   ├── wix/                           # WiX configuration
│   └── scripts/                       # Pre/post install scripts
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docker-compose.yml                 # Dev environment (PostgreSQL + PostGIS)
├── run_tests.sh                       # Test runner script
├── package.json                       # Root workspace package.json
├── tsconfig.base.json
└── README.md
```
