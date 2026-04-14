/**
 * Postings Routes – Comprehensive Authorization & Behavior Tests
 *
 * Covers all five handlers in backend/src/routes/postings.ts:
 *   GET  /api/projects/:projectId/postings  (list, paginated)
 *   POST /api/projects/:projectId/postings  (create)
 *   GET  /api/postings/:id                  (detail)
 *   PUT  /api/postings/:id                  (update)
 *   DELETE /api/postings/:id                (soft-delete / archive)
 */

import Fastify, { FastifyInstance } from 'fastify';
import fjwt from '@fastify/jwt';

const mockCheckProjectAccess = jest.fn();
const mockCheckPostingAccess = jest.fn();

jest.mock('../../../backend/src/services/project-access', () => ({
  checkProjectAccess: (...args: unknown[]) => mockCheckProjectAccess(...args),
  checkPostingAccess: (...args: unknown[]) => mockCheckPostingAccess(...args),
}));

import postingRoutes from '../../../backend/src/routes/postings';

const JWT_SECRET = 'test-secret';
const mockQuery = jest.fn();
const mockDb = { query: mockQuery } as any;

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fjwt, { secret: JWT_SECRET });

  app.decorate('authenticate', async function (request: any, reply: any) {
    try { await request.jwtVerify(); } catch { reply.status(401).send({ error: 'Unauthorized' }); }
  });
  app.decorate('authorize', function (...roles: string[]) {
    return async function (request: any, reply: any) {
      try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
      if (!roles.includes(request.user.role)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Insufficient permissions' });
      }
    };
  });

  app.decorate('db', mockDb);
  await app.register(postingRoutes);
  await app.ready();
  return app;
}

import { UserRole } from '../../../backend/src/models';

function signToken(app: FastifyInstance, payload: { id: string; username: string; role: UserRole }) {
  return app.jwt.sign(payload);
}

const recruiterA = { id: 'recruiter-a-id', username: 'recruiterA', role: 'recruiter' as UserRole };
const recruiterB = { id: 'recruiter-b-id', username: 'recruiterB', role: 'recruiter' as UserRole };

let app: FastifyInstance;

beforeAll(async () => { app = await buildTestApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => {
  mockQuery.mockReset();
  mockCheckProjectAccess.mockReset();
  mockCheckPostingAccess.mockReset();
});

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/postings
// ---------------------------------------------------------------------------
describe('GET /api/projects/:projectId/postings', () => {
  it('returns 404 when project is not found', async () => {
    // Project lookup returns no rows
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/nonexistent-proj/postings',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toBe('Not Found');
    expect(mockCheckProjectAccess).not.toHaveBeenCalled();
  });

  it('returns 403 when access is denied on the parent project', async () => {
    // Project exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'proj-1' }] });
    // Access denied
    mockCheckProjectAccess.mockResolvedValueOnce({
      allowed: false, status: 403, message: 'You do not have access to this project',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/proj-1/postings',
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toBe('Forbidden');
  });

  it('returns 200 with paginated data when access is allowed', async () => {
    const postingRow = {
      id: 'posting-1',
      project_id: 'proj-1',
      title: 'Engineer',
      description: null,
      requirements: null,
      field_rules: null,
      status: 'open',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };

    // Project exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'proj-1' }] });
    // Access allowed
    mockCheckProjectAccess.mockResolvedValueOnce({ allowed: true });
    // COUNT query
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] });
    // Data query
    mockQuery.mockResolvedValueOnce({ rows: [postingRow] });

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/proj-1/postings?page=1&pageSize=25',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].id).toBe('posting-1');
  });

  it('returns 500 when a database error occurs', async () => {
    // Project exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'proj-1' }] });
    // Access allowed
    mockCheckProjectAccess.mockResolvedValueOnce({ allowed: true });
    // COUNT query throws
    mockQuery.mockRejectedValueOnce(new Error('DB failure'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/proj-1/postings',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toBe('Internal Server Error');
  });
});

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/postings
// ---------------------------------------------------------------------------
describe('POST /api/projects/:projectId/postings', () => {
  it('returns 404 when project is not found', async () => {
    // Project lookup returns no rows
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/nonexistent-proj/postings',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: { title: 'Test Posting' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toBe('Not Found');
    expect(mockCheckProjectAccess).not.toHaveBeenCalled();
  });

  it('returns 403 when recruiter does not own the parent project', async () => {
    // Project exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'proj-1' }] });
    // Access denied
    mockCheckProjectAccess.mockResolvedValueOnce({
      allowed: false, status: 403, message: 'You do not have access to this project',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/proj-1/postings',
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
      payload: { title: 'Test Posting' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toBe('Forbidden');
  });

  it('creates posting when recruiter owns the project', async () => {
    // Project exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'proj-1' }] });
    // Access allowed
    mockCheckProjectAccess.mockResolvedValueOnce({ allowed: true });
    // INSERT RETURNING
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'posting-1', project_id: 'proj-1', title: 'Test Posting', status: 'draft' }],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/proj-1/postings',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: { title: 'Test Posting' },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload).title).toBe('Test Posting');
  });

  it('returns 500 when a database error occurs during insert', async () => {
    // Project exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'proj-1' }] });
    // Access allowed
    mockCheckProjectAccess.mockResolvedValueOnce({ allowed: true });
    // INSERT throws
    mockQuery.mockRejectedValueOnce(new Error('DB failure'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/proj-1/postings',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: { title: 'Test Posting' },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toBe('Internal Server Error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/postings/:id
// ---------------------------------------------------------------------------
describe('GET /api/postings/:id', () => {
  it('returns 404 when the posting is not found', async () => {
    // Posting lookup returns no rows
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/api/postings/nonexistent-posting',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toBe('Not Found');
    expect(mockCheckPostingAccess).not.toHaveBeenCalled();
  });

  it('returns 403 when access is denied on the posting', async () => {
    const postingRow = {
      id: 'posting-1',
      project_id: 'proj-1',
      title: 'Engineer',
      status: 'open',
    };

    // Posting exists
    mockQuery.mockResolvedValueOnce({ rows: [postingRow] });
    // Access denied
    mockCheckPostingAccess.mockResolvedValueOnce({
      allowed: false, status: 403, message: 'You do not have access to this posting',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/postings/posting-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toBe('Forbidden');
  });

  it('returns 200 with the posting when access is allowed', async () => {
    const postingRow = {
      id: 'posting-1',
      project_id: 'proj-1',
      title: 'Engineer',
      description: 'A great role',
      requirements: null,
      field_rules: null,
      status: 'open',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };

    // Posting exists
    mockQuery.mockResolvedValueOnce({ rows: [postingRow] });
    // Access allowed
    mockCheckPostingAccess.mockResolvedValueOnce({ allowed: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/postings/posting-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.id).toBe('posting-1');
    expect(body.title).toBe('Engineer');
  });

  it('returns 500 when a database error occurs', async () => {
    // Query throws
    mockQuery.mockRejectedValueOnce(new Error('DB failure'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/postings/posting-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toBe('Internal Server Error');
  });
});

// ---------------------------------------------------------------------------
// PUT /api/postings/:id
// ---------------------------------------------------------------------------
describe('PUT /api/postings/:id', () => {
  it('returns 404 when the posting is not found', async () => {
    // Existence check returns no rows
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/postings/nonexistent-posting',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: { title: 'Updated Title' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toBe('Not Found');
    expect(mockCheckPostingAccess).not.toHaveBeenCalled();
  });

  it('returns 403 when access is denied on the posting', async () => {
    // Posting exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'posting-1' }] });
    // Access denied
    mockCheckPostingAccess.mockResolvedValueOnce({
      allowed: false, status: 403, message: 'You do not have access to this posting',
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/postings/posting-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
      payload: { title: 'Updated Title' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toBe('Forbidden');
  });

  it('returns 200 with updated posting when update succeeds', async () => {
    const updatedRow = {
      id: 'posting-1',
      project_id: 'proj-1',
      title: 'Updated Title',
      description: null,
      requirements: null,
      field_rules: null,
      status: 'open',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-06-01T00:00:00.000Z',
    };

    // Existence check
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'posting-1' }] });
    // Access allowed
    mockCheckPostingAccess.mockResolvedValueOnce({ allowed: true });
    // UPDATE RETURNING
    mockQuery.mockResolvedValueOnce({ rows: [updatedRow] });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/postings/posting-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: { title: 'Updated Title' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.id).toBe('posting-1');
    expect(body.title).toBe('Updated Title');
  });

  it('returns 500 when a database error occurs during update', async () => {
    // Existence check
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'posting-1' }] });
    // Access allowed
    mockCheckPostingAccess.mockResolvedValueOnce({ allowed: true });
    // UPDATE throws
    mockQuery.mockRejectedValueOnce(new Error('DB failure'));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/postings/posting-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: { title: 'Updated Title' },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toBe('Internal Server Error');
  });

  it('covers description/requirements/field_rules/status branches in update', async () => {
    const updatedRow = {
      id: 'posting-1', project_id: 'proj-1', title: 'Same Title',
      description: 'New desc', requirements: ['req1'], field_rules: { key: 'val' },
      status: 'closed', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-06-01T00:00:00.000Z',
    };
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'posting-1' }] });
    mockCheckPostingAccess.mockResolvedValueOnce({ allowed: true });
    mockQuery.mockResolvedValueOnce({ rows: [updatedRow] });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/postings/posting-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: {
        description: 'New desc',
        requirements: { minimum: '3 years' },
        field_rules: { requiredFields: ['ssn'] },
        status: 'closed',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.description).toBe('New desc');
    expect(body.status).toBe('closed');
  });

  it('returns 404 when UPDATE RETURNING finds no matching row (posting archived mid-request)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'posting-1' }] });
    mockCheckPostingAccess.mockResolvedValueOnce({ allowed: true });
    // UPDATE returns empty (already archived between existence check and update)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/postings/posting-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: { title: 'Too Late' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toBe('Not Found');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/postings/:id
// ---------------------------------------------------------------------------
describe('DELETE /api/postings/:id', () => {
  it('returns 403 when recruiter does not own the parent project', async () => {
    mockCheckPostingAccess.mockResolvedValueOnce({
      allowed: false, status: 403, message: 'You do not have access to this project',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/postings/posting-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toBe('Forbidden');
    // No DB mutation should have occurred
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('archives posting when recruiter owns the project', async () => {
    mockCheckPostingAccess.mockResolvedValueOnce({ allowed: true });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'posting-1' }] }); // archive returns

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/postings/posting-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when posting is not found after access check (archive returns empty rows)', async () => {
    // Access allowed but the UPDATE finds no matching row (already archived or missing)
    mockCheckPostingAccess.mockResolvedValueOnce({ allowed: true });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/postings/already-archived',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toBe('Not Found');
  });

  it('returns 500 when a database error occurs during archive', async () => {
    // Access allowed but UPDATE throws
    mockCheckPostingAccess.mockResolvedValueOnce({ allowed: true });
    mockQuery.mockRejectedValueOnce(new Error('DB failure'));

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/postings/posting-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toBe('Internal Server Error');
  });
});
