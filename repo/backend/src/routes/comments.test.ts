/**
 * Comments Routes – Entity-Level Authorization Tests
 *
 * Verifies that GET and POST /api/comments enforce entity-level access
 * checks and return 403 for users without access to the underlying entity.
 */

import Fastify, { FastifyInstance } from 'fastify';
import fjwt from '@fastify/jwt';

const mockCheckCandidateAccess = jest.fn();
const mockCheckProjectAccess = jest.fn();
const mockCheckPostingAccess = jest.fn();

jest.mock('../services/candidate-access', () => ({
  checkCandidateAccess: (...args: unknown[]) => mockCheckCandidateAccess(...args),
}));

jest.mock('../services/project-access', () => ({
  checkProjectAccess: (...args: unknown[]) => mockCheckProjectAccess(...args),
  checkPostingAccess: (...args: unknown[]) => mockCheckPostingAccess(...args),
}));

import commentRoutes from './comments';

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
  await app.register(commentRoutes);
  await app.ready();
  return app;
}

import { UserRole } from '../models';

function signToken(app: FastifyInstance, payload: { id: string; username: string; role: UserRole }) {
  return app.jwt.sign(payload);
}

const recruiterA = { id: 'recruiter-a-id', username: 'recruiterA', role: 'recruiter' as UserRole };
const recruiterB = { id: 'recruiter-b-id', username: 'recruiterB', role: 'recruiter' as UserRole };
const admin = { id: 'admin-id', username: 'admin', role: 'admin' as UserRole };

let app: FastifyInstance;

beforeAll(async () => { app = await buildTestApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => {
  mockQuery.mockReset();
  mockCheckCandidateAccess.mockReset();
  mockCheckProjectAccess.mockReset();
  mockCheckPostingAccess.mockReset();
});

describe('GET /api/comments', () => {
  it('returns 403 when user lacks access to the candidate entity', async () => {
    mockCheckCandidateAccess.mockResolvedValueOnce({
      allowed: false, status: 403, message: "You do not have access to this candidate's resources",
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/comments?entityType=candidate&entityId=cand-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toBe('Forbidden');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks access to the project entity', async () => {
    mockCheckProjectAccess.mockResolvedValueOnce({
      allowed: false, status: 403, message: 'You do not have access to this project',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/comments?entityType=project&entityId=proj-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns comments when user has access to the entity', async () => {
    mockCheckCandidateAccess.mockResolvedValueOnce({ allowed: true });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'comment-1', entity_type: 'candidate', entity_id: 'cand-1', author_id: 'user-1', body: 'Test', created_at: new Date().toISOString(), author_username: 'testuser' },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/comments?entityType=candidate&entityId=cand-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].body).toBe('Test');
  });
});

describe('POST /api/comments', () => {
  it('returns 403 when user lacks access to the entity', async () => {
    mockCheckCandidateAccess.mockResolvedValueOnce({
      allowed: false, status: 403, message: "You do not have access to this candidate's resources",
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/comments',
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
      payload: { entity_type: 'candidate', entity_id: 'cand-1', body: 'Hello' },
    });

    expect(res.statusCode).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('creates comment when user has entity access', async () => {
    mockCheckCandidateAccess.mockResolvedValueOnce({ allowed: true });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'comment-new', entity_type: 'candidate', entity_id: 'cand-1',
        author_id: recruiterA.id, body: 'Nice candidate', created_at: new Date().toISOString(),
      }],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/comments',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: { entity_type: 'candidate', entity_id: 'cand-1', body: 'Nice candidate' },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload).body).toBe('Nice candidate');
  });

  it('uses posting access check for posting entity type', async () => {
    mockCheckPostingAccess.mockResolvedValueOnce({ allowed: true });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'comment-new', entity_type: 'posting', entity_id: 'posting-1',
        author_id: recruiterA.id, body: 'Comment on posting', created_at: new Date().toISOString(),
      }],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/comments',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: { entity_type: 'posting', entity_id: 'posting-1', body: 'Comment on posting' },
    });

    expect(res.statusCode).toBe(201);
    expect(mockCheckPostingAccess).toHaveBeenCalled();
  });
});
