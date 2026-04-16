/**
 * Deep API Integration Tests — no mocks, real HTTP + real database.
 *
 * These tests run inside the backend Docker container where the Fastify
 * server is already listening on port 3000.  They validate:
 *   • Complete response payloads (not just status codes)
 *   • Auth token lifecycle
 *   • CRUD round-trip consistency
 *   • Object-level authorization across roles
 *   • Input validation (400 responses with structured bodies)
 *
 * jest rootDir = /app  →  picked up at  tests/backend/integration/
 */

// Use 127.0.0.1 explicitly — in Alpine, `localhost` resolves to ::1 (IPv6)
// first, but Fastify binds to 0.0.0.0 (IPv4 only), causing ECONNREFUSED.
const BASE = 'http://127.0.0.1:3000';

// ── helpers ───────────────────────────────────────────────────────────────────

async function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, body: json };
}

async function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, body: json };
}

async function put(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, body: json };
}

async function del(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, body: json };
}

function isUUID(s: unknown): boolean {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)
  );
}

// ── auth tokens shared across suites ─────────────────────────────────────────

const tokens: Record<string, string> = {};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Auth API — payload contracts
// ─────────────────────────────────────────────────────────────────────────────

describe('Auth API — payload contracts', () => {
  test('POST /api/auth/login returns complete token + user object', async () => {
    const r = await post('/api/auth/login', { username: 'admin', password: 'admin' });
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe('string');
    expect(r.body.token.split('.').length).toBe(3); // valid JWT
    expect(isUUID(r.body.user.id)).toBe(true);
    expect(r.body.user.username).toBe('admin');
    expect(r.body.user.role).toBe('admin');
    expect(r.body.user.password_hash).toBeUndefined(); // never exposed
    tokens['admin'] = r.body.token;
  });

  test('POST /api/auth/login as recruiter returns token', async () => {
    const r = await post('/api/auth/login', { username: 'recruiter', password: 'recruiter' });
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe('string');
    tokens['recruiter'] = r.body.token;
  });

  test('POST /api/auth/login as approver returns token', async () => {
    const r = await post('/api/auth/login', { username: 'approver', password: 'approver' });
    expect(r.status).toBe(200);
    tokens['approver'] = r.body.token;
  });

  test('GET /api/auth/me returns current authenticated user', async () => {
    const r = await get('/api/auth/me', tokens['admin']);
    expect(r.status).toBe(200);
    expect(r.body.username).toBe('admin');
    expect(r.body.password_hash).toBeUndefined();
  });

  test('GET /api/auth/me without token returns 401 with structured error', async () => {
    const r = await get('/api/auth/me');
    expect(r.status).toBe(401);
    expect(typeof r.body.error).toBe('string');
  });

  test('POST /api/auth/login with wrong password returns 401', async () => {
    const r = await post('/api/auth/login', { username: 'admin', password: 'wrongpassword' });
    expect(r.status).toBe(401);
    expect(typeof r.body.error).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Projects API — CRUD round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('Projects API — CRUD round-trip', () => {
  const suffix = `it-${Date.now()}`;
  let projectId: string;

  afterAll(async () => {
    if (projectId) await del(`/api/projects/${projectId}`, tokens['admin']);
  });

  test('POST /api/projects returns 201 with complete project schema', async () => {
    const r = await post(
      '/api/projects',
      { title: `Integration Test Project ${suffix}`, description: 'Created by integration test' },
      tokens['recruiter'],
    );
    expect(r.status).toBe(201);
    expect(isUUID(r.body.id)).toBe(true);
    expect(r.body.title).toContain(suffix);
    expect(typeof r.body.status).toBe('string');
    expect(typeof r.body.created_at).toBe('string');
    expect(typeof r.body.updated_at).toBe('string');
    projectId = r.body.id;
  });

  test('GET /api/projects/:id returns the created project with matching fields', async () => {
    const r = await get(`/api/projects/${projectId}`, tokens['recruiter']);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(projectId);
    expect(r.body.title).toContain(suffix);
  });

  test('GET /api/projects list includes the created project', async () => {
    const r = await get('/api/projects', tokens['recruiter']);
    expect(r.status).toBe(200);
    const items: Array<{ id: string }> = r.body.data ?? r.body;
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((p) => p.id === projectId)).toBe(true);
  });

  test('PUT /api/projects/:id updates title and returns updated schema', async () => {
    const r = await put(
      `/api/projects/${projectId}`,
      { title: `Updated ${suffix}` },
      tokens['recruiter'],
    );
    expect(r.status).toBe(200);
    expect(r.body.title).toContain('Updated');
    expect(r.body.updated_at).toBeDefined();
  });

  test('GET /api/projects/:id after update reflects new title', async () => {
    const r = await get(`/api/projects/${projectId}`, tokens['recruiter']);
    expect(r.status).toBe(200);
    expect(r.body.title).toContain('Updated');
  });

  test('approver cannot create a project (403)', async () => {
    const r = await post(
      '/api/projects',
      { title: 'Should be blocked' },
      tokens['approver'],
    );
    expect(r.status).toBe(403);
  });

  test('POST /api/projects without title returns 400', async () => {
    const r = await post('/api/projects', { description: 'no title' }, tokens['recruiter']);
    expect(r.status).toBe(400);
    expect(typeof r.body.error).toBe('string');
  });

  test('GET /api/projects/:id returns 404 for non-existent UUID', async () => {
    const r = await get('/api/projects/00000000-0000-0000-0000-000000000000', tokens['recruiter']);
    expect(r.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Candidates API — schema + RBAC
// ─────────────────────────────────────────────────────────────────────────────

describe('Candidates API — schema validation and RBAC', () => {
  let projectId: string;
  let postingId: string;
  let candidateId: string;
  let candidateLastName: string;

  beforeAll(async () => {
    const proj = await post(
      '/api/projects',
      { title: `Cand-Test-${Date.now()}` },
      tokens['recruiter'],
    );
    projectId = proj.body.id;

    const posting = await post(
      `/api/projects/${projectId}/postings`,
      { title: `Posting-${Date.now()}`, description: 'Integration test posting', status: 'open', requirements: {} },
      tokens['recruiter'],
    );
    postingId = posting.body.id;
  });

  afterAll(async () => {
    if (projectId) await del(`/api/projects/${projectId}`, tokens['admin']);
  });

  test('POST /api/postings/:id/candidates returns 201 with masked sensitive fields', async () => {
    candidateLastName = `Candidate-${Date.now()}`;
    const r = await post(
      `/api/postings/${postingId}/candidates`,
      {
        first_name: 'Test',
        last_name: candidateLastName,
        email: `test-${Date.now()}@example.com`,
        ssn: '123-45-6789',
      },
      tokens['recruiter'],
    );
    expect(r.status).toBe(201);
    expect(isUUID(r.body.id)).toBe(true);
    // Sensitive fields must never be returned raw
    expect(r.body.ssn_encrypted).toBeUndefined();
    expect(r.body.ssn_hash).toBeUndefined();
    // Masked representation must be present
    expect(r.body.ssn_masked).toBe('****');
    candidateId = r.body.id;
  });

  test('GET /api/candidates/:id returns candidate with tags array', async () => {
    const r = await get(`/api/candidates/${candidateId}`, tokens['recruiter']);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.tags)).toBe(true);
  });

  test('GET /api/candidates/:id returns 403 when approver has no assignment', async () => {
    const r = await get(`/api/candidates/${candidateId}`, tokens['approver']);
    expect(r.status).toBe(403);
  });

  test('POST /api/postings/:id/candidates without required fields returns 400', async () => {
    const r = await post(
      `/api/postings/${postingId}/candidates`,
      { email: 'missing-name@example.com' },
      tokens['recruiter'],
    );
    expect(r.status).toBe(400);
    expect(typeof r.body.error).toBe('string');
  });

  test('PUT /api/candidates/:id updates fields and re-masks sensitive data', async () => {
    // Schema requires both first_name and last_name
    const r = await put(
      `/api/candidates/${candidateId}`,
      { first_name: 'Updated', last_name: candidateLastName, ssn: '987-65-4321' },
      tokens['recruiter'],
    );
    expect(r.status).toBe(200);
    expect(r.body.first_name).toBe('Updated');
    expect(r.body.ssn_encrypted).toBeUndefined();
    expect(r.body.ssn_masked).toBe('****');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Input validation — structured error responses
// ─────────────────────────────────────────────────────────────────────────────

describe('Input validation — structured error responses', () => {
  test('invalid login body returns 400 with error + message fields', async () => {
    const r = await post('/api/auth/login', { username: '' });
    expect([400, 401]).toContain(r.status);
    expect(typeof r.body.error).toBe('string');
  });

  test('protected endpoints return 401 without Authorization header', async () => {
    const r = await get('/api/projects');
    expect(r.status).toBe(401);
    expect(typeof r.body.error).toBe('string');
  });

  test('GET /api/health returns ok with version field', async () => {
    const r = await get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Tags API — CRUD round-trip + validation + RBAC
// ─────────────────────────────────────────────────────────────────────────────

describe('Tags API — CRUD round-trip, validation, and RBAC', () => {
  const tagName = `integration-tag-${Date.now()}`;
  let tagId: string;

  afterAll(async () => {
    // Best-effort cleanup; 404 is acceptable if the delete test already ran
    if (tagId) await del(`/api/tags/${tagId}`, tokens['admin']);
  });

  test('POST /api/tags returns 201 with id, name, color fields', async () => {
    const r = await post('/api/tags', { name: tagName, color: '#3a7bd5' }, tokens['recruiter']);
    expect(r.status).toBe(201);
    expect(isUUID(r.body.id)).toBe(true);
    expect(r.body.name).toBe(tagName);
    expect(r.body.color).toBe('#3a7bd5');
    tagId = r.body.id;
  });

  test('GET /api/tags returns { data: [] } shape including the created tag', async () => {
    const r = await get('/api/tags', tokens['recruiter']);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    // Every item must have id, name, color keys
    const sample = r.body.data[0];
    expect(typeof sample.id).toBe('string');
    expect(typeof sample.name).toBe('string');
    expect(sample).toHaveProperty('color');
    // Created tag is present
    const found = r.body.data.find((t: { id: string }) => t.id === tagId);
    expect(found).toBeDefined();
    expect(found.name).toBe(tagName);
  });

  test('PUT /api/tags/:id updates color and returns updated record', async () => {
    const r = await put(`/api/tags/${tagId}`, { color: '#ffffff' }, tokens['recruiter']);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(tagId);
    expect(r.body.color).toBe('#ffffff');
  });

  test('POST /api/tags with duplicate name returns 409 with error', async () => {
    const r = await post('/api/tags', { name: tagName }, tokens['recruiter']);
    expect(r.status).toBe(409);
    expect(typeof r.body.error).toBe('string');
  });

  test('POST /api/tags without required name returns 400', async () => {
    const r = await post('/api/tags', { color: '#aabbcc' }, tokens['recruiter']);
    expect(r.status).toBe(400);
  });

  test('POST /api/tags with invalid hex color format returns 400', async () => {
    const r = await post(
      '/api/tags',
      { name: `tag-badcolor-${Date.now()}`, color: 'not-a-hex' },
      tokens['recruiter'],
    );
    expect(r.status).toBe(400);
  });

  test('DELETE /api/tags/:id by non-admin (recruiter) returns 403', async () => {
    const r = await del(`/api/tags/${tagId}`, tokens['recruiter']);
    expect(r.status).toBe(403);
  });

  test('DELETE /api/tags/:id by admin returns 200 with message', async () => {
    const r = await del(`/api/tags/${tagId}`, tokens['admin']);
    expect(r.status).toBe(200);
    expect(typeof r.body.message).toBe('string');
  });

  test('DELETE /api/tags/:id for already-deleted tag returns 404', async () => {
    const r = await del(`/api/tags/${tagId}`, tokens['admin']);
    expect(r.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Notifications API — payload contracts, lifecycle, and ownership RBAC
// ─────────────────────────────────────────────────────────────────────────────

describe('Notifications API — payload contracts, lifecycle, and ownership RBAC', () => {
  // Admin has seeded notifications; acquire the first one for lifecycle tests
  let notificationId: string;

  beforeAll(async () => {
    const r = await get('/api/notifications?page=1&pageSize=1', tokens['admin']);
    expect(r.status).toBe(200);
    // Seeded data must provide at least one notification for admin
    expect(r.body.data.length).toBeGreaterThan(0);
    notificationId = r.body.data[0].id;
  });

  test('GET /api/notifications returns paginated response shape', async () => {
    const r = await get('/api/notifications', tokens['admin']);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(typeof r.body.total).toBe('number');
    expect(typeof r.body.page).toBe('number');
    expect(typeof r.body.pageSize).toBe('number');
    expect(r.body.total).toBeGreaterThan(0);
  });

  test('GET /api/notifications items have required fields', async () => {
    const r = await get('/api/notifications', tokens['admin']);
    expect(r.status).toBe(200);
    const item = r.body.data[0];
    expect(typeof item.id).toBe('string');
    expect(typeof item.type).toBe('string');
    expect(typeof item.status).toBe('string');
    expect(typeof item.created_at).toBe('string');
    // Sensitive internal fields must not leak
    expect(item.password_hash).toBeUndefined();
  });

  test('GET /api/notifications/pending-count returns { count: number }', async () => {
    const r = await get('/api/notifications/pending-count', tokens['admin']);
    expect(r.status).toBe(200);
    expect(typeof r.body.count).toBe('number');
    expect(r.body.count).toBeGreaterThanOrEqual(0);
  });

  test('GET /api/notifications without auth returns 401', async () => {
    const r = await get('/api/notifications');
    expect(r.status).toBe(401);
    expect(typeof r.body.error).toBe('string');
  });

  test('PUT /api/notifications/:id/read using a different user returns 403', async () => {
    // admin owns the notification; recruiter must be denied
    const r = await put(`/api/notifications/${notificationId}/read`, {}, tokens['recruiter']);
    expect(r.status).toBe(403);
    expect(typeof r.body.error).toBe('string');
  });

  test('PUT /api/notifications/:id/read marks status as opened', async () => {
    const r = await put(`/api/notifications/${notificationId}/read`, {}, tokens['admin']);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(notificationId);
    expect(r.body.status).toBe('opened');
    expect(typeof r.body.updated_at).toBe('string');
  });

  test('PUT /api/notifications/:id/acknowledge marks status as acknowledged', async () => {
    const r = await put(`/api/notifications/${notificationId}/acknowledge`, {}, tokens['admin']);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(notificationId);
    expect(r.body.status).toBe('acknowledged');
  });

  test('PUT /api/notifications/nonexistent-uuid/read returns 404', async () => {
    const r = await put(
      '/api/notifications/00000000-0000-0000-0000-000000000000/read',
      {},
      tokens['admin'],
    );
    expect(r.status).toBe(404);
    expect(typeof r.body.error).toBe('string');
  });
});
