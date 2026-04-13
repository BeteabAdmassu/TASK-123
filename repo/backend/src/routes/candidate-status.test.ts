/**
 * Candidate Status Transition Tests
 *
 * Verifies that status changes enforce required-field validation and
 * return 400 with clear field lists when fields are missing.
 */

import Fastify, { FastifyInstance } from 'fastify';
import fjwt from '@fastify/jwt';

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

jest.mock('../services/project-access', () => ({
  checkPostingAccess: jest.fn().mockResolvedValue({ allowed: true }),
}));

import candidateRoutes from './candidates';

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
  await app.register(candidateRoutes);
  await app.ready();
  return app;
}

import { UserRole } from '../models';

function signToken(app: FastifyInstance, payload: { id: string; username: string; role: UserRole }) {
  return app.jwt.sign(payload);
}

const recruiter = { id: 'recruiter-id', username: 'recruiter', role: 'recruiter' as UserRole };
const CANDIDATE_ID = 'cand-001';

let app: FastifyInstance;

beforeAll(async () => { app = await buildTestApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => {
  mockQuery.mockReset();
  mockCheckCandidateAccess.mockReset();
});

describe('PATCH /api/candidates/:id/status', () => {
  it('returns 400 with missing_fields when advancing with missing email/phone', async () => {
    mockCheckCandidateAccess.mockResolvedValueOnce({ allowed: true });
    // Candidate with missing email and phone
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: CANDIDATE_ID,
        email: null,
        phone: null,
        eeoc_disposition: null,
        ssn_encrypted: null,
        dob_encrypted: null,
        compensation_encrypted: null,
        status: 'intake',
        field_rules: null,
      }],
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/candidates/${CANDIDATE_ID}/status`,
      headers: { authorization: `Bearer ${signToken(app, recruiter)}` },
      payload: { status: 'screening' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Bad Request');
    expect(body.missing_fields).toContain('email');
    expect(body.missing_fields).toContain('phone');
  });

  it('returns 400 with field_rules-based missing fields', async () => {
    mockCheckCandidateAccess.mockResolvedValueOnce({ allowed: true });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: CANDIDATE_ID,
        email: 'test@example.com',
        phone: '555-1234',
        eeoc_disposition: null,
        ssn_encrypted: null,
        dob_encrypted: null,
        compensation_encrypted: null,
        status: 'intake',
        field_rules: { requiredFields: ['eeoc_disposition', 'ssn'] },
      }],
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/candidates/${CANDIDATE_ID}/status`,
      headers: { authorization: `Bearer ${signToken(app, recruiter)}` },
      payload: { status: 'review' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.missing_fields).toContain('eeoc_disposition');
    expect(body.missing_fields).toContain('ssn');
  });

  it('allows status change when all required fields are present', async () => {
    mockCheckCandidateAccess.mockResolvedValueOnce({ allowed: true });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: CANDIDATE_ID,
        email: 'test@example.com',
        phone: '555-1234',
        eeoc_disposition: 'Completed',
        ssn_encrypted: Buffer.from('encrypted'),
        dob_encrypted: null,
        compensation_encrypted: null,
        status: 'intake',
        field_rules: null,
      }],
    });
    // UPDATE RETURNING
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: CANDIDATE_ID,
        status: 'screening',
        ssn_encrypted: null,
        dob_encrypted: null,
        compensation_encrypted: null,
        ssn_hash: null,
      }],
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/candidates/${CANDIDATE_ID}/status`,
      headers: { authorization: `Bearer ${signToken(app, recruiter)}` },
      payload: { status: 'screening' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('screening');
  });

  it('allows rejection even with missing fields', async () => {
    mockCheckCandidateAccess.mockResolvedValueOnce({ allowed: true });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: CANDIDATE_ID,
        email: null,
        phone: null,
        eeoc_disposition: null,
        ssn_encrypted: null,
        dob_encrypted: null,
        compensation_encrypted: null,
        status: 'intake',
        field_rules: null,
      }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: CANDIDATE_ID,
        status: 'rejected',
        ssn_encrypted: null,
        dob_encrypted: null,
        compensation_encrypted: null,
        ssn_hash: null,
      }],
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/candidates/${CANDIDATE_ID}/status`,
      headers: { authorization: `Bearer ${signToken(app, recruiter)}` },
      payload: { status: 'rejected' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('rejected');
  });

  it('returns 403 when recruiter does not own the candidate', async () => {
    mockCheckCandidateAccess.mockResolvedValueOnce({
      allowed: false, status: 403, message: "You do not have access to this candidate's resources",
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/candidates/${CANDIDATE_ID}/status`,
      headers: { authorization: `Bearer ${signToken(app, recruiter)}` },
      payload: { status: 'screening' },
    });

    expect(res.statusCode).toBe(403);
  });
});
