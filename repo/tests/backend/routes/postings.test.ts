/**
 * Postings Routes – Object-Level Authorization Tests
 *
 * Verifies that create and delete posting endpoints enforce
 * parent project access checks and return 403 for unauthorized users.
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

describe('POST /api/projects/:projectId/postings', () => {
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
});

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
});
