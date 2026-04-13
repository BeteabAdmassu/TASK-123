/**
 * Candidate Routes – Object-Level Authorization Tests
 *
 * Verifies that all candidate endpoints enforce access checks and return
 * a consistent 403 denial message across read, reveal, and mutation routes.
 */

import Fastify, { FastifyInstance } from 'fastify';
import fjwt from '@fastify/jwt';

// Mock candidate-access before importing routes
const mockCheckCandidateAccess = jest.fn();
jest.mock('../services/candidate-access', () => ({
  checkCandidateAccess: (...args: unknown[]) => mockCheckCandidateAccess(...args),
}));

jest.mock('../services/audit.service', () => ({
  createAuditEntry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/notification.service', () => ({
  createNotification: jest.fn().mockResolvedValue('notif-id'),
}));

jest.mock('../services/violation-scanner', () => ({
  scanCandidate: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/encryption.service', () => ({
  encryptField: jest.fn((v: string) => `enc_${v}`),
  decryptField: jest.fn((v: string) => v.replace('enc_', '')),
  maskField: jest.fn(() => '****'),
  deterministicHash: jest.fn((v: string) => `hash_${v}`),
}));

import candidateRoutes from './candidates';
import { createNotification } from '../services/notification.service';
import { createAuditEntry } from '../services/audit.service';
import { UserRole } from '../models';

// ---------- helpers ----------

const JWT_SECRET = 'test-secret';
const DENIAL_MESSAGE = "You do not have access to this candidate's resources";

const mockQuery = jest.fn();
const mockDb = { query: mockQuery } as any;

/** Build a minimal Fastify app with auth + candidate routes. */
async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fjwt, { secret: JWT_SECRET });

  // Auth decorators (mirrors plugins/auth.ts)
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

  // Inject mock db
  app.decorate('db', mockDb);

  await app.register(candidateRoutes);
  await app.ready();
  return app;
}

function signToken(app: FastifyInstance, payload: { id: string; username: string; role: UserRole }) {
  return app.jwt.sign(payload);
}

// Recruiter A – owns the candidate's project
const recruiterA = { id: 'recruiter-a-id', username: 'recruiterA', role: 'recruiter' as UserRole };
// Recruiter B – does NOT own the candidate's project
const recruiterB = { id: 'recruiter-b-id', username: 'recruiterB', role: 'recruiter' as UserRole };
// Approver with no approval-step assignment for the candidate
const unrelatedApprover = { id: 'approver-x-id', username: 'approverX', role: 'approver' as UserRole };

const CANDIDATE_ID = 'cand-001';
const NONEXISTENT_ID = 'cand-does-not-exist';
const TAG_ID = '00000000-0000-4000-8000-000000000001';

/** Helper: configure mockCheckCandidateAccess to deny */
function denyAccess() {
  mockCheckCandidateAccess.mockResolvedValueOnce({
    allowed: false, status: 403, message: DENIAL_MESSAGE,
  });
}

/** Helper: configure mockCheckCandidateAccess to allow */
function allowAccess() {
  mockCheckCandidateAccess.mockResolvedValueOnce({ allowed: true });
}

// ---------- test suite ----------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  mockQuery.mockReset();
  mockCheckCandidateAccess.mockReset();
  (createNotification as jest.Mock).mockClear();
  (createAuditEntry as jest.Mock).mockClear();
});

// ---- GET /api/candidates/:id ----

describe('GET /api/candidates/:id', () => {
  const url = `/api/candidates/${CANDIDATE_ID}`;

  it('returns 403 with normalized message when recruiter does not own the candidate', async () => {
    // Candidate exists but is owned by recruiterA
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CANDIDATE_ID, first_name: 'Jane', last_name: 'Doe', project_owner: recruiterA.id, ssn_encrypted: null, dob_encrypted: null, compensation_encrypted: null, ssn_hash: null }],
    });

    const res = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload)).toEqual({ error: 'Forbidden', message: DENIAL_MESSAGE });
  });

  it('returns 403 with normalized message when approver has no assignment for this candidate', async () => {
    // Candidate exists
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CANDIDATE_ID, first_name: 'Jane', last_name: 'Doe', project_owner: recruiterA.id, ssn_encrypted: null, dob_encrypted: null, compensation_encrypted: null, ssn_hash: null }],
    });
    // Approver step lookup returns nothing
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${signToken(app, unrelatedApprover)}` },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload)).toEqual({ error: 'Forbidden', message: DENIAL_MESSAGE });
  });
});

// ---- POST /api/candidates/:id/reveal ----

describe('POST /api/candidates/:id/reveal', () => {
  const url = `/api/candidates/${CANDIDATE_ID}/reveal`;
  const validBody = { password: 'secret', field: 'ssn' };

  it('returns 403 with normalized message when recruiter does not own the candidate', async () => {
    denyAccess();

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload)).toEqual({ error: 'Forbidden', message: DENIAL_MESSAGE });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ---- PUT /api/candidates/:id ----

describe('PUT /api/candidates/:id', () => {
  const url = `/api/candidates/${CANDIDATE_ID}`;
  const validBody = { first_name: 'Jane', last_name: 'Doe' };

  it('returns 403 when recruiter does not own the candidate (no DB query before auth)', async () => {
    denyAccess();

    const res = await app.inject({
      method: 'PUT',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ error: 'Forbidden', message: DENIAL_MESSAGE });
    // No DB queries should have been made by the handler (auth check is the mock, not a DB call)
    expect(mockQuery).not.toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it('returns identical 403 for a nonexistent candidate ID (anti-enumeration)', async () => {
    denyAccess();

    const res = await app.inject({
      method: 'PUT',
      url: `/api/candidates/${NONEXISTENT_ID}`,
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ error: 'Forbidden', message: DENIAL_MESSAGE });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('allows update when recruiter owns the candidate', async () => {
    allowAccess();
    // SELECT existing candidate
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CANDIDATE_ID, first_name: 'Old', last_name: 'Name', email: null, phone: null, eeoc_disposition: null, ssn_encrypted: null, ssn_hash: null, dob_encrypted: null, compensation_encrypted: null }],
    });
    // UPDATE … RETURNING *
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CANDIDATE_ID, first_name: 'Jane', last_name: 'Doe', email: null, phone: null, ssn_encrypted: null, dob_encrypted: null, compensation_encrypted: null, ssn_hash: null, eeoc_disposition: null }],
    });

    const res = await app.inject({
      method: 'PUT',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.first_name).toBe('Jane');
  });
});

// ---- POST /api/candidates/:id/tags ----

describe('POST /api/candidates/:id/tags', () => {
  const url = `/api/candidates/${CANDIDATE_ID}/tags`;
  const validBody = { tagId: TAG_ID };

  it('returns 403 when recruiter does not own the candidate (no DB query before auth)', async () => {
    denyAccess();

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ error: 'Forbidden', message: DENIAL_MESSAGE });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it('returns identical 403 for a nonexistent candidate ID (anti-enumeration)', async () => {
    denyAccess();

    const res = await app.inject({
      method: 'POST',
      url: `/api/candidates/${NONEXISTENT_ID}/tags`,
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ error: 'Forbidden', message: DENIAL_MESSAGE });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('allows adding a tag when recruiter owns the candidate', async () => {
    allowAccess();
    // Candidate exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CANDIDATE_ID }] });
    // Tag exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TAG_ID, name: 'Urgent' }] });
    // No existing assignment
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.tag_id).toBe(TAG_ID);
  });
});

// ---- DELETE /api/candidates/:id/tags/:tagId ----

describe('DELETE /api/candidates/:id/tags/:tagId', () => {
  const url = `/api/candidates/${CANDIDATE_ID}/tags/${TAG_ID}`;

  it('returns 403 when recruiter does not own the candidate (no DB query before auth)', async () => {
    denyAccess();

    const res = await app.inject({
      method: 'DELETE',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ error: 'Forbidden', message: DENIAL_MESSAGE });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it('returns identical 403 for a nonexistent candidate ID (anti-enumeration)', async () => {
    denyAccess();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/candidates/${NONEXISTENT_ID}/tags/${TAG_ID}`,
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ error: 'Forbidden', message: DENIAL_MESSAGE });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('allows removing a tag when recruiter owns the candidate', async () => {
    allowAccess();
    // DELETE … RETURNING *
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ candidate_id: CANDIDATE_ID, tag_id: TAG_ID }] });

    const res = await app.inject({
      method: 'DELETE',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(204);
  });
});

// ---- POST /api/candidates/:id/request-materials ----

describe('POST /api/candidates/:id/request-materials', () => {
  const url = `/api/candidates/${CANDIDATE_ID}/request-materials`;
  const validBody = { message: 'Please send your transcript' };

  it('returns 403 when recruiter does not own the candidate (no DB query before auth)', async () => {
    denyAccess();

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ error: 'Forbidden', message: DENIAL_MESSAGE });
    // Verify NO side effects: no DB reads, no notification, no audit
    expect(mockQuery).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it('returns identical 403 for a nonexistent candidate ID (anti-enumeration)', async () => {
    denyAccess();

    const res = await app.inject({
      method: 'POST',
      url: `/api/candidates/${NONEXISTENT_ID}/request-materials`,
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ error: 'Forbidden', message: DENIAL_MESSAGE });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it('allows request-materials when recruiter owns the candidate', async () => {
    allowAccess();
    // Candidate exists
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CANDIDATE_ID, first_name: 'Jane', last_name: 'Doe', project_owner: 'recruiter-a-id' }],
    });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    expect(createNotification).toHaveBeenCalled();
  });
});
