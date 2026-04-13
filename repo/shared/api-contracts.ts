/**
 * Shared API contract constants.
 * Used by both backend route registration and frontend service calls
 * to guarantee endpoint path/method alignment.
 *
 * Convention: all paths are relative (no /api prefix here);
 * the backend mounts them under /api, the frontend ApiService prepends /api.
 */

// ─── Auth ──────────────────────────────────────────────
export const AUTH = {
  LOGIN:           'POST /auth/login',
  LOGOUT:          'POST /auth/logout',
  ME:              'GET  /auth/me',
  VERIFY_PASSWORD: 'POST /auth/verify-password',
} as const;

// ─── Users ─────────────────────────────────────────────
export const USERS = {
  LIST:   'GET    /users',
  CREATE: 'POST   /users',
  UPDATE: 'PUT    /users/:id',
  DELETE: 'DELETE /users/:id',
} as const;

// ─── Recruiting Projects ───────────────────────────────
export const PROJECTS = {
  LIST:   'GET    /projects',
  CREATE: 'POST   /projects',
  DETAIL: 'GET    /projects/:id',
  UPDATE: 'PUT    /projects/:id',
  DELETE: 'DELETE /projects/:id',
} as const;

// ─── Job Postings ──────────────────────────────────────
export const POSTINGS = {
  LIST:   'GET    /projects/:projectId/postings',
  CREATE: 'POST   /projects/:projectId/postings',
  DETAIL: 'GET    /postings/:id',
  UPDATE: 'PUT    /postings/:id',
  DELETE: 'DELETE /postings/:id',
} as const;

// ─── Candidates ────────────────────────────────────────
export const CANDIDATES = {
  LIST:              'GET    /postings/:postingId/candidates',
  CREATE:            'POST   /postings/:postingId/candidates',
  DETAIL:            'GET    /candidates/:id',
  UPDATE:            'PUT    /candidates/:id',
  REVEAL:            'POST   /candidates/:id/reveal',
  ADD_TAG:           'POST   /candidates/:id/tags',
  REMOVE_TAG:        'DELETE /candidates/:id/tags/:tagId',
  REQUEST_MATERIALS: 'POST   /candidates/:id/request-materials',
  SCAN:              'POST   /candidates/:id/scan',
} as const;

// ─── Resume Versions ───────────────────────────────────
export const RESUMES = {
  LIST:   'GET  /candidates/:candidateId/resumes',
  CREATE: 'POST /candidates/:candidateId/resumes',
  DETAIL: 'GET  /resumes/:id',
  LATEST: 'GET  /candidates/:candidateId/resumes/latest',
} as const;

// ─── Attachments ───────────────────────────────────────
export const ATTACHMENTS = {
  LIST:     'GET    /candidates/:candidateId/attachments',
  UPLOAD:   'POST   /candidates/:candidateId/attachments',
  DETAIL:   'GET    /attachments/:id',
  DOWNLOAD: 'GET    /attachments/:id/download',
  DELETE:   'DELETE /attachments/:id',
} as const;

// ─── Violations ────────────────────────────────────────
export const VIOLATIONS = {
  LIST:        'GET  /violations',
  DETAIL:      'GET  /violations/:id',
  REVIEW:      'PUT  /violations/:id/review',
  RULES_LIST:  'GET  /violations/rules',
  RULES_CREATE:'POST /violations/rules',
  RULES_UPDATE:'PUT  /violations/rules/:id',
} as const;

// ─── Service Catalog ───────────────────────────────────
export const SERVICES = {
  CATEGORIES_LIST:   'GET    /services/categories',
  CATEGORIES_CREATE: 'POST   /services/categories',
  CATEGORIES_UPDATE: 'PUT    /services/categories/:id',
  CATEGORIES_DELETE: 'DELETE /services/categories/:id',
  ATTRIBUTES_LIST:   'GET    /services/categories/:id/attributes',
  ATTRIBUTES_CREATE: 'POST   /services/categories/:id/attributes',

  SPECS_LIST:        'GET    /services/specifications',
  SPECS_CREATE:      'POST   /services/specifications',
  SPECS_DETAIL:      'GET    /services/specifications/:id',
  SPECS_UPDATE:      'PUT    /services/specifications/:id',
  SPECS_STATUS:      'PUT    /services/specifications/:id/status',
  SPECS_ADD_TAG:     'POST   /services/specifications/:id/tags',
  SPECS_REMOVE_TAG:  'DELETE /services/specifications/:id/tags/:tagId',

  PRICING_LIST:      'GET    /services/specifications/:id/pricing',
  PRICING_CREATE:    'POST   /services/specifications/:id/pricing',
  PRICING_UPDATE:    'PUT    /services/pricing/:id',
  PRICING_DELETE:    'DELETE /services/pricing/:id',

  CAPACITY_LIST:     'GET    /services/specifications/:id/capacity',
  CAPACITY_CREATE:   'POST   /services/specifications/:id/capacity',
  CAPACITY_UPDATE:   'PUT    /services/capacity/:id',
} as const;

// ─── Credit Changes ────────────────────────────────────
export const CREDIT_CHANGES = {
  LIST:   'GET  /credit-changes',
  CREATE: 'POST /credit-changes',
  DETAIL: 'GET  /credit-changes/:id',
} as const;

// ─── Approval Templates ───────────────────────────────
export const APPROVAL_TEMPLATES = {
  LIST:   'GET    /approval-templates',
  CREATE: 'POST   /approval-templates',
  DETAIL: 'GET    /approval-templates/:id',
  UPDATE: 'PUT    /approval-templates/:id',
  DELETE: 'DELETE /approval-templates/:id',
} as const;

// ─── Approvals ─────────────────────────────────────────
export const APPROVALS = {
  LIST:      'GET  /approvals',
  CREATE:    'POST /approvals',
  DETAIL:    'GET  /approvals/:id',
  DECIDE:    'PUT  /approvals/:id/steps/:stepId',   // NOT /decide
  AUDIT:     'GET  /approvals/:id/audit',
} as const;

// ─── Notification Templates ───────────────────────────
export const NOTIFICATION_TEMPLATES = {
  LIST:   'GET    /notification-templates',
  CREATE: 'POST   /notification-templates',
  UPDATE: 'PUT    /notification-templates/:id',
  DELETE: 'DELETE /notification-templates/:id',
} as const;

// ─── Notifications ─────────────────────────────────────
export const NOTIFICATIONS = {
  LIST:          'GET  /notifications',
  MARK_READ:     'PUT  /notifications/:id/read',
  ACKNOWLEDGE:   'PUT  /notifications/:id/acknowledge',
  PENDING_COUNT: 'GET  /notifications/pending-count',
  EXPORT:        'POST /notifications/export/:id',
} as const;

// ─── Tags ──────────────────────────────────────────────
export const TAGS = {
  LIST:   'GET    /tags',
  CREATE: 'POST   /tags',
  UPDATE: 'PUT    /tags/:id',
  DELETE: 'DELETE /tags/:id',
} as const;

// ─── Comments ──────────────────────────────────────────
export const COMMENTS = {
  LIST:   'GET    /comments',
  CREATE: 'POST   /comments',
  DELETE: 'DELETE /comments/:id',
} as const;

// ─── Geospatial ────────────────────────────────────────
export const GEO = {
  DATASETS_LIST:   'GET    /geo/datasets',
  DATASETS_IMPORT: 'POST   /geo/datasets/import',
  DATASETS_DETAIL: 'GET    /geo/datasets/:id',
  DATASETS_DELETE: 'DELETE /geo/datasets/:id',
  FEATURES:        'GET    /geo/datasets/:id/features',
  AGGREGATE:       'GET    /geo/datasets/:id/aggregate',
  DENSITY:         'GET    /geo/datasets/:id/density',
  BUFFER:          'GET    /geo/datasets/:id/buffer',
  ROUTES:          'GET    /geo/datasets/:id/routes',
} as const;

// ─── Media / VOD ───────────────────────────────────────
export const MEDIA = {
  LIST:           'GET /media',
  DETAIL:         'GET /media/:id',
  PLAYBACK_STATE: 'GET /media/:id/playback-state',   // NOT /playback
  SAVE_PLAYBACK:  'PUT /media/:id/playback-state',   // PUT not POST
  SUBTITLES:      'GET /media/:id/subtitles',
} as const;

// ─── System ────────────────────────────────────────────
export const SYSTEM = {
  HEALTH:       'GET  /health',
  SEARCH:       'GET  /search',
  CHECKPOINT:   'POST /checkpoint',
  CHECKPOINT_LATEST: 'GET /checkpoint/latest',
  AUDIT:        'GET  /audit',
  UPDATE_INFO:  'GET  /system/update-info',
  APPLY_UPDATE: 'POST /system/apply-update',
  ROLLBACK:     'POST /system/rollback',
} as const;

// ─── Standard paginated response envelope ──────────────
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
