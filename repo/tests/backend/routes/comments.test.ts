/**
 * Comments Routes – Entity-Level Authorization Tests
 *
 * Verifies that GET, POST, and DELETE /api/comments enforce entity-level
 * access checks and return correct status codes for all scenarios.
 */

import Fastify, { FastifyInstance } from 'fastify';
import fjwt from '@fastify/jwt';

const mockCheckCandidateAccess = jest.fn();
const mockCheckProjectAccess = jest.fn();
const mockCheckPostingAccess = jest.fn();

jest.mock('../../../backend/src/services/candidate-access', () => ({
  checkCandidateAccess: (...args: unknown[]) => mockCheckCandidateAccess(...args),
}));

jest.mock('../../../backend/src/services/project-access', () => ({
  checkProjectAccess: (...args: unknown[]) => mockCheckProjectAccess(...args),
  checkPostingAccess: (...args: unknown[]) => mockCheckPostingAccess(...args),
}));

import commentRoutes from '../../../backend/src/routes/comments';

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

import { UserRole } from '../../../backend/src/models';

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

  it('returns 403 for unsupported entity type when user is not admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/comments?entityType=unknown_entity&entityId=entity-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(403);
    expect(mockCheckCandidateAccess).not.toHaveBeenCalled();
    expect(mockCheckProjectAccess).not.toHaveBeenCalled();
    expect(mockCheckPostingAccess).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 200 for unsupported entity type when user IS admin (admin bypass)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'comment-2', entity_type: 'unknown_entity', entity_id: 'entity-1', author_id: admin.id, body: 'Admin comment', created_at: new Date().toISOString(), author_username: 'admin' },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/comments?entityType=unknown_entity&entityId=entity-1',
      headers: { authorization: `Bearer ${signToken(app, admin)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(mockCheckCandidateAccess).not.toHaveBeenCalled();
    expect(mockCheckProjectAccess).not.toHaveBeenCalled();
    expect(mockCheckPostingAccess).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalled();
  });

  it('returns 500 on database error', async () => {
    mockCheckCandidateAccess.mockResolvedValueOnce({ allowed: true });
    mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/comments?entityType=candidate&entityId=cand-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toBe('Internal Server Error');
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

  it('returns 500 on database error', async () => {
    mockCheckCandidateAccess.mockResolvedValueOnce({ allowed: true });
    mockQuery.mockRejectedValueOnce(new Error('DB insert failed'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/comments',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: { entity_type: 'candidate', entity_id: 'cand-1', body: 'This will fail' },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toBe('Internal Server Error');
  });
});

describe('DELETE /api/comments/:id', () => {
  it('returns 404 when comment is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/comments/nonexistent-id',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toBe('Not Found');
    expect(JSON.parse(res.payload).message).toBe('Comment not found');
  });

  it('returns 403 when a non-author non-admin tries to delete', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'comment-1',
        author_id: recruiterA.id,
        entity_type: 'candidate',
        entity_id: 'cand-1',
      }],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/comments/comment-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toBe('Forbidden');
    expect(JSON.parse(res.payload).message).toBe('You can only delete your own comments');
  });

  it('returns 200 when the author deletes their own comment', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'comment-1',
          author_id: recruiterA.id,
          entity_type: 'candidate',
          entity_id: 'cand-1',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/comments/comment-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).message).toBe('Comment deleted successfully');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('returns 200 when admin deletes another user\'s comment', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'comment-1',
          author_id: recruiterA.id,
          entity_type: 'candidate',
          entity_id: 'cand-1',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/comments/comment-1',
      headers: { authorization: `Bearer ${signToken(app, admin)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).message).toBe('Comment deleted successfully');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('returns 500 on database error during lookup', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB query failed'));

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/comments/comment-1',
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toBe('Internal Server Error');
    expect(JSON.parse(res.payload).message).toBe('Failed to delete comment');
  });
});
