/**
 * Candidate Routes – Authorization & Behavior Tests
 *
 * Covers all route handlers in backend/src/routes/candidates.ts:
 *   GET  /api/postings/:postingId/candidates
 *   POST /api/postings/:postingId/candidates
 *   GET  /api/candidates/:id
 *   PUT  /api/candidates/:id
 *   PUT  /api/candidates/:id/status  (covered by candidate-status.test.ts)
 *   POST /api/candidates/:id/reveal
 *   POST /api/candidates/:id/tags
 *   DELETE /api/candidates/:id/tags/:tagId
 *   POST /api/candidates/:id/request-materials
 */

import Fastify, { FastifyInstance } from 'fastify';
import fjwt from '@fastify/jwt';

// Mock candidate-access before importing routes
const mockCheckCandidateAccess = jest.fn();
jest.mock('../../../backend/src/services/candidate-access', () => ({
  checkCandidateAccess: (...args: unknown[]) => mockCheckCandidateAccess(...args),
}));

const mockCheckPostingAccess = jest.fn();
jest.mock('../../../backend/src/services/project-access', () => ({
  checkPostingAccess: (...args: unknown[]) => mockCheckPostingAccess(...args),
}));

jest.mock('../../../backend/src/services/audit.service', () => ({
  createAuditEntry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../backend/src/services/notification.service', () => ({
  createNotification: jest.fn().mockResolvedValue('notif-id'),
}));

jest.mock('../../../backend/src/services/violation-scanner', () => ({
  scanCandidate: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../backend/src/services/encryption.service', () => ({
  encryptField: jest.fn((v: string) => `enc_${v}`),
  decryptField: jest.fn((v: string) => v.replace('enc_', '')),
  maskField: jest.fn(() => '****'),
  deterministicHash: jest.fn((v: string) => `hash_${v}`),
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

import candidateRoutes from '../../../backend/src/routes/candidates';
import { createNotification } from '../../../backend/src/services/notification.service';
import { createAuditEntry } from '../../../backend/src/services/audit.service';
import { UserRole } from '../../../backend/src/models';
import * as bcrypt from 'bcryptjs';

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
// Admin – bypasses all object-level auth
const admin = { id: 'admin-id', username: 'adminUser', role: 'admin' as UserRole };

const CANDIDATE_ID = 'cand-001';
const POSTING_ID = 'posting-001';
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
  mockCheckPostingAccess.mockReset();
  (createNotification as jest.Mock).mockClear();
  (createAuditEntry as jest.Mock).mockClear();
  (bcrypt.compare as jest.Mock).mockReset();
});

// ---- GET /api/postings/:postingId/candidates ----

describe('GET /api/postings/:postingId/candidates', () => {
  const url = `/api/postings/${POSTING_ID}/candidates`;

  it('returns 404 when the posting does not exist', async () => {
    // Posting check returns empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toBe('Not Found');
    expect(mockCheckPostingAccess).not.toHaveBeenCalled();
  });

  it('returns 403 when access is denied on the posting', async () => {
    // Posting exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: POSTING_ID }] });
    // Access denied
    mockCheckPostingAccess.mockResolvedValueOnce({
      allowed: false, status: 403, message: 'Forbidden',
    });

    const res = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toBe('Forbidden');
  });

  it('returns 200 with paginated candidate list when access is allowed', async () => {
    // Posting exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: POSTING_ID }] });
    // Access allowed
    mockCheckPostingAccess.mockResolvedValueOnce({ allowed: true });
    // COUNT query
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] });
    // Data query
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'cand-1', first_name: 'Alice', last_name: 'Smith', ssn_encrypted: null, dob_encrypted: null, compensation_encrypted: null, ssn_hash: null },
        { id: 'cand-2', first_name: 'Bob', last_name: 'Jones', ssn_encrypted: null, dob_encrypted: null, compensation_encrypted: null, ssn_hash: null },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(2);
    expect(body.page).toBe(1);
    // Sensitive fields must not leak
    expect(body.data[0].ssn_encrypted).toBeUndefined();
  });

  it('returns 500 when a database error occurs', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB failure'));

    const res = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(500);
  });
});

// ---- POST /api/postings/:postingId/candidates ----

describe('POST /api/postings/:postingId/candidates', () => {
  const url = `/api/postings/${POSTING_ID}/candidates`;
  const validBody = { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' };

  it('returns 404 when the posting does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toBe('Not Found');
  });

  it('returns 403 when access is denied on the posting', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: POSTING_ID }] });
    mockCheckPostingAccess.mockResolvedValueOnce({
      allowed: false, status: 403, message: 'Forbidden',
    });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterB)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(403);
  });

  it('creates candidate and returns 201 when access is allowed', async () => {
    const createdRow = {
      id: 'new-cand-1',
      job_posting_id: POSTING_ID,
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      phone: null,
      ssn_encrypted: null,
      ssn_hash: null,
      dob_encrypted: null,
      compensation_encrypted: null,
      eeoc_disposition: null,
    };

    // Posting exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: POSTING_ID }] });
    // Access allowed
    mockCheckPostingAccess.mockResolvedValueOnce({ allowed: true });
    // INSERT RETURNING
    mockQuery.mockResolvedValueOnce({ rows: [createdRow] });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.first_name).toBe('Jane');
    expect(body.ssn_encrypted).toBeUndefined();
    expect(createAuditEntry).toHaveBeenCalled();
  });

  it('returns 500 when a database error occurs', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: POSTING_ID }] });
    mockCheckPostingAccess.mockResolvedValueOnce({ allowed: true });
    mockQuery.mockRejectedValueOnce(new Error('DB failure'));

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(500);
  });
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

  it('returns 404 when candidate is not found', async () => {
    // Query returns empty for admin
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: `/api/candidates/${NONEXISTENT_ID}`,
      headers: { authorization: `Bearer ${signToken(app, admin)}` },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toBe('Not Found');
  });

  it('returns 200 with masked candidate and tags for admin (bypasses access check)', async () => {
    // Candidate row
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: CANDIDATE_ID, first_name: 'Jane', last_name: 'Doe',
        project_owner: recruiterA.id,
        ssn_encrypted: 'enc_123', ssn_hash: 'hash_123',
        dob_encrypted: null, compensation_encrypted: null,
      }],
    });
    // Tags query
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: TAG_ID, name: 'Priority', color: '#ff0000' }],
    });

    const res = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${signToken(app, admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.id).toBe(CANDIDATE_ID);
    // Sensitive columns must be stripped
    expect(body.ssn_encrypted).toBeUndefined();
    expect(body.ssn_hash).toBeUndefined();
    // Masked field should exist
    expect(body.ssn_masked).toBe('****');
    // Tags should be included
    expect(body.tags).toHaveLength(1);
    expect(body.tags[0].name).toBe('Priority');
  });

  it('returns 500 on unexpected database error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB crash'));

    const res = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${signToken(app, admin)}` },
    });

    expect(res.statusCode).toBe(500);
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

  it('returns 404 when candidate is not found after access check', async () => {
    allowAccess();
    // SELECT existing candidate returns empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'PUT',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toBe('Not Found');
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

  it('returns 500 when a database error occurs during update', async () => {
    allowAccess();
    mockQuery.mockRejectedValueOnce(new Error('DB failure'));

    const res = await app.inject({
      method: 'PUT',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toBe('Internal Server Error');
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

  it('returns 404 when the requesting user is not found in the DB', async () => {
    allowAccess();
    // User lookup returns empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).message).toBe('User not found');
  });

  it('returns 403 when password verification fails', async () => {
    allowAccess();
    // User found with hash
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: 'wrong_hash' }] });
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).message).toBe('Invalid password');
  });

  it('returns 404 when candidate row is not found after password check', async () => {
    allowAccess();
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: 'hashed' }] });
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
    // Candidate lookup returns empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).message).toBe('Candidate not found');
  });

  it('returns 404 when the requested field is not set on the candidate', async () => {
    allowAccess();
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: 'hashed' }] });
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
    // Candidate found but ssn_encrypted is null
    mockQuery.mockResolvedValueOnce({ rows: [{ ssn_encrypted: null }] });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).message).toContain('"ssn" is not set');
  });

  it('returns 200 with decrypted field value on success', async () => {
    allowAccess();
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: 'hashed' }] });
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
    // Candidate found with encrypted value
    mockQuery.mockResolvedValueOnce({ rows: [{ ssn_encrypted: 'enc_123-45-6789' }] });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.field).toBe('ssn');
    // decryptField mock strips 'enc_' prefix
    expect(body.value).toBe('123-45-6789');
    expect(createAuditEntry).toHaveBeenCalled();
  });

  it('returns 500 on unexpected database error', async () => {
    allowAccess();
    mockQuery.mockRejectedValueOnce(new Error('DB crash'));

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(500);
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

  it('returns 404 when candidate is not found after access check', async () => {
    allowAccess();
    // Candidate check returns empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).message).toBe('Candidate not found');
  });

  it('returns 404 when tag does not exist', async () => {
    allowAccess();
    // Candidate exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CANDIDATE_ID }] });
    // Tag check returns empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).message).toBe('Tag not found');
  });

  it('returns 409 when tag is already assigned to the candidate', async () => {
    allowAccess();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CANDIDATE_ID }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TAG_ID, name: 'Urgent' }] });
    // Already assigned
    mockQuery.mockResolvedValueOnce({ rows: [{ candidate_id: CANDIDATE_ID, tag_id: TAG_ID }] });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload).message).toContain('already assigned');
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

  it('returns 500 on unexpected database error', async () => {
    allowAccess();
    mockQuery.mockRejectedValueOnce(new Error('DB crash'));

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(500);
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

  it('returns 404 when the tag assignment is not found', async () => {
    allowAccess();
    // DELETE returns no rows
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await app.inject({
      method: 'DELETE',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).message).toContain('Tag assignment not found');
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

  it('returns 500 on unexpected database error', async () => {
    allowAccess();
    mockQuery.mockRejectedValueOnce(new Error('DB crash'));

    const res = await app.inject({
      method: 'DELETE',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
    });

    expect(res.statusCode).toBe(500);
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

  it('returns 404 when candidate is not found after access check', async () => {
    allowAccess();
    // Candidate query returns empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).message).toBe('Candidate not found');
  });

  it('falls back to requesting user when candidate has no project_owner', async () => {
    allowAccess();
    // Candidate found but no project_owner (orphaned)
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CANDIDATE_ID, first_name: 'Jane', last_name: 'Doe', project_owner: null }],
    });

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    // Notification should be sent to the requesting user (fallback)
    expect(createNotification).toHaveBeenCalledWith(
      expect.anything(),
      recruiterA.id, // falls back to request.user.id
      'materials_requested',
      expect.any(Object),
    );
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

  it('returns 500 on unexpected database error', async () => {
    allowAccess();
    mockQuery.mockRejectedValueOnce(new Error('DB crash'));

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${signToken(app, recruiterA)}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(500);
  });
});
