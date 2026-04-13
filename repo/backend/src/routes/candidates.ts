import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as bcrypt from 'bcryptjs';
import { encryptField, decryptField, maskField, deterministicHash } from '../services/encryption.service';
import { scanCandidate } from '../services/violation-scanner';
import { createNotification } from '../services/notification.service';
import { createAuditEntry } from '../services/audit.service';
import * as candidateAccess from '../services/candidate-access';
import { checkPostingAccess } from '../services/project-access';

interface CandidateBody {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  ssn?: string;
  dob?: string;
  compensation?: string;
  eeoc_disposition?: string;
}

interface RevealBody {
  password: string;
  field: 'ssn' | 'dob' | 'compensation';
}

interface TagBody {
  tagId: string;
}

interface RequestMaterialsBody {
  message: string;
}

interface PostingParams {
  postingId: string;
}

interface CandidateParams {
  id: string;
}

interface CandidateTagParams {
  id: string;
  tagId: string;
}

interface ListQuery {
  page?: string;
  pageSize?: string;
}

const SENSITIVE_FIELDS = ['ssn_encrypted', 'dob_encrypted', 'compensation_encrypted'] as const;

const FIELD_TO_COLUMN: Record<string, string> = {
  ssn: 'ssn_encrypted',
  dob: 'dob_encrypted',
  compensation: 'compensation_encrypted',
};

const candidateBodySchema = {
  body: {
    type: 'object',
    required: ['first_name', 'last_name'],
    properties: {
      first_name: { type: 'string', minLength: 1, maxLength: 100 },
      last_name: { type: 'string', minLength: 1, maxLength: 100 },
      email: { type: 'string', format: 'email', maxLength: 255 },
      phone: { type: 'string', maxLength: 50 },
      ssn: { type: 'string', maxLength: 20 },
      dob: { type: 'string', maxLength: 20 },
      compensation: { type: 'string', maxLength: 50 },
      eeoc_disposition: { type: 'string', maxLength: 100 },
    },
    additionalProperties: false,
  },
};

const revealSchema = {
  body: {
    type: 'object',
    required: ['password', 'field'],
    properties: {
      password: { type: 'string', minLength: 1 },
      field: { type: 'string', enum: ['ssn', 'dob', 'compensation'] },
    },
    additionalProperties: false,
  },
};

const tagSchema = {
  body: {
    type: 'object',
    required: ['tagId'],
    properties: {
      tagId: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  },
};

const requestMaterialsSchema = {
  body: {
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string', minLength: 1, maxLength: 1000 },
    },
    additionalProperties: false,
  },
};

function maskCandidateRow(row: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...row };
  // Replace raw encrypted columns with clean masked display fields
  masked.ssn_masked = masked.ssn_encrypted ? '****' : null;
  masked.dob_masked = masked.dob_encrypted ? '****' : null;
  masked.compensation_masked = masked.compensation_encrypted ? '****' : null;
  // Remove internal columns that must not leak to clients
  delete masked.ssn_encrypted;
  delete masked.dob_encrypted;
  delete masked.compensation_encrypted;
  delete masked.ssn_hash;
  return masked;
}

export default async function candidateRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/postings/:postingId/candidates - list candidates for posting (paginated)
  fastify.get<{ Params: PostingParams; Querystring: ListQuery }>(
    '/api/postings/:postingId/candidates',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Params: PostingParams; Querystring: ListQuery }>, reply: FastifyReply) => {
      const { postingId } = request.params;
      const page = Math.max(1, parseInt(request.query.page || '1', 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(request.query.pageSize || '20', 10)));
      const offset = (page - 1) * pageSize;

      try {
        const postingCheck = await fastify.db.query(
          'SELECT id FROM job_postings WHERE id = $1',
          [postingId]
        );
        if (postingCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Job posting not found' });
        }

        // Object-level auth via posting's parent project
        const access = await checkPostingAccess(fastify.db, postingId, request.user.id, request.user.role);
        if (!access.allowed) {
          return reply.status(access.status!).send({ error: 'Forbidden', message: access.message });
        }

        const countResult = await fastify.db.query(
          'SELECT COUNT(*) FROM candidates WHERE job_posting_id = $1 AND archived_at IS NULL',
          [postingId]
        );
        const total = parseInt(countResult.rows[0].count, 10);

        const result = await fastify.db.query(
          `SELECT * FROM candidates
           WHERE job_posting_id = $1 AND archived_at IS NULL
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [postingId, pageSize, offset]
        );

        const data = result.rows.map(maskCandidateRow);

        return reply.send({ data, total, page, pageSize });
      } catch (err) {
        fastify.log.error({ err, postingId }, 'Failed to list candidates');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/postings/:postingId/candidates - create candidate
  fastify.post<{ Params: PostingParams; Body: CandidateBody }>(
    '/api/postings/:postingId/candidates',
    { schema: candidateBodySchema, preHandler: [fastify.authorize('admin', 'recruiter')] },
    async (request: FastifyRequest<{ Params: PostingParams; Body: CandidateBody }>, reply: FastifyReply) => {
      const { postingId } = request.params;
      const { first_name, last_name, email, phone, ssn, dob, compensation, eeoc_disposition } = request.body;

      try {
        const postingCheck = await fastify.db.query(
          'SELECT id FROM job_postings WHERE id = $1',
          [postingId]
        );
        if (postingCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Job posting not found' });
        }

        const ssnEncrypted = ssn ? encryptField(ssn) : null;
        const ssnHash = ssn ? deterministicHash(ssn) : null;
        const dobEncrypted = dob ? encryptField(dob) : null;
        const compensationEncrypted = compensation ? encryptField(compensation) : null;

        const result = await fastify.db.query(
          `INSERT INTO candidates (job_posting_id, first_name, last_name, email, phone, ssn_encrypted, ssn_hash, dob_encrypted, compensation_encrypted, eeoc_disposition)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [postingId, first_name, last_name, email || null, phone || null, ssnEncrypted, ssnHash, dobEncrypted, compensationEncrypted, eeoc_disposition || null]
        );

        const candidate = result.rows[0];

        await createAuditEntry(
          fastify.db,
          'candidate',
          candidate.id,
          'create',
          request.user.id,
          null,
          { first_name, last_name, email, phone, eeoc_disposition },
          { job_posting_id: postingId }
        );

        // Run violation scan
        const violations = await scanCandidate(fastify.db, candidate.id);
        if (violations.length > 0) {
          fastify.log.info({ candidateId: candidate.id, violationCount: violations.length }, 'Violations detected on candidate creation');
        }

        const masked = maskCandidateRow(candidate);

        return reply.status(201).send(masked);
      } catch (err) {
        fastify.log.error({ err, postingId }, 'Failed to create candidate');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // GET /api/candidates/:id - get candidate detail
  // Object-level auth: admin/reviewer see all; recruiter sees only candidates
  // in postings under projects they created; approver sees via approval assignments.
  fastify.get<{ Params: CandidateParams }>(
    '/api/candidates/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Params: CandidateParams }>, reply: FastifyReply) => {
      const { id } = request.params;
      const userId = request.user.id;
      const userRole = request.user.role;

      try {
        const result = await fastify.db.query(
          `SELECT c.*, jp.project_id, rp.created_by AS project_owner
           FROM candidates c
           LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
           LEFT JOIN recruiting_projects rp ON rp.id = jp.project_id
           WHERE c.id = $1`,
          [id]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Candidate not found' });
        }

        // Admin and reviewer can see any candidate
        if (userRole !== 'admin' && userRole !== 'reviewer') {
          const row = result.rows[0];
          // Recruiter must own the project, or be assigned as approver on a related approval
          if (userRole === 'recruiter' && row.project_owner !== userId) {
            return reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to this candidate\'s resources' });
          }
          if (userRole === 'approver') {
            // Approvers may view candidates only if they have an approval step assignment for this candidate
            const approverCheck = await fastify.db.query(
              `SELECT 1 FROM approval_requests ar
               JOIN approval_steps ast ON ast.request_id = ar.id
               WHERE ar.entity_type = 'candidate' AND ar.entity_id = $1 AND ast.approver_id = $2
               LIMIT 1`,
              [id, userId]
            );
            if (approverCheck.rows.length === 0) {
              return reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to this candidate\'s resources' });
            }
          }
        }

        const masked = maskCandidateRow(result.rows[0]);

        // Include tags
        const tagsResult = await fastify.db.query(
          `SELECT t.id, t.name, t.color FROM tags t
           INNER JOIN candidate_tags ct ON ct.tag_id = t.id
           WHERE ct.candidate_id = $1`,
          [id]
        );

        const response = { ...masked, tags: tagsResult.rows };

        return reply.send(response);
      } catch (err) {
        fastify.log.error({ err, candidateId: id }, 'Failed to get candidate');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // PUT /api/candidates/:id - update candidate
  fastify.put<{ Params: CandidateParams; Body: CandidateBody }>(
    '/api/candidates/:id',
    { schema: candidateBodySchema, preHandler: [fastify.authorize('admin', 'recruiter')] },
    async (request: FastifyRequest<{ Params: CandidateParams; Body: CandidateBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { first_name, last_name, email, phone, ssn, dob, compensation, eeoc_disposition } = request.body;

      try {
        // Object-level authorization first — prevents candidate-ID enumeration
        const access = await candidateAccess.checkCandidateAccess(fastify.db, id, request.user.id, request.user.role);
        if (!access.allowed) {
          return reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to this candidate\'s resources' });
        }

        const existing = await fastify.db.query(
          'SELECT * FROM candidates WHERE id = $1',
          [id]
        );

        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Candidate not found' });
        }

        const beforeState = {
          first_name: existing.rows[0].first_name,
          last_name: existing.rows[0].last_name,
          email: existing.rows[0].email,
          phone: existing.rows[0].phone,
          eeoc_disposition: existing.rows[0].eeoc_disposition,
        };

        const ssnEncrypted = ssn !== undefined ? (ssn ? encryptField(ssn) : null) : existing.rows[0].ssn_encrypted;
        const ssnHash = ssn !== undefined ? (ssn ? deterministicHash(ssn) : null) : existing.rows[0].ssn_hash;
        const dobEncrypted = dob !== undefined ? (dob ? encryptField(dob) : null) : existing.rows[0].dob_encrypted;
        const compensationEncrypted = compensation !== undefined ? (compensation ? encryptField(compensation) : null) : existing.rows[0].compensation_encrypted;

        const result = await fastify.db.query(
          `UPDATE candidates
           SET first_name = $1, last_name = $2, email = $3, phone = $4,
               ssn_encrypted = $5, ssn_hash = $6, dob_encrypted = $7, compensation_encrypted = $8,
               eeoc_disposition = $9, updated_at = NOW()
           WHERE id = $10
           RETURNING *`,
          [first_name, last_name, email || null, phone || null, ssnEncrypted, ssnHash, dobEncrypted, compensationEncrypted, eeoc_disposition || null, id]
        );

        const afterState = { first_name, last_name, email, phone, eeoc_disposition };

        await createAuditEntry(
          fastify.db,
          'candidate',
          id,
          'update',
          request.user.id,
          beforeState,
          afterState
        );

        // Re-scan for violations
        const violations = await scanCandidate(fastify.db, id);
        if (violations.length > 0) {
          fastify.log.info({ candidateId: id, violationCount: violations.length }, 'Violations detected on candidate update');
        }

        const masked = maskCandidateRow(result.rows[0]);

        return reply.send(masked);
      } catch (err) {
        fastify.log.error({ err, candidateId: id }, 'Failed to update candidate');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/candidates/:id/reveal - reveal a sensitive field
  // Restricted to admin/recruiter/reviewer with object-level candidate access + password re-entry
  fastify.post<{ Params: CandidateParams; Body: RevealBody }>(
    '/api/candidates/:id/reveal',
    { schema: revealSchema, preHandler: [fastify.authorize('admin', 'recruiter', 'reviewer')] },
    async (request: FastifyRequest<{ Params: CandidateParams; Body: RevealBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { password, field } = request.body;

      try {
        // Object-level authorization: verify caller has access to this candidate
        const access = await candidateAccess.checkCandidateAccess(fastify.db, id, request.user.id, request.user.role);
        if (!access.allowed) {
          return reply.status(access.status!).send({ error: 'Forbidden', message: access.message });
        }

        // Verify user password
        const userResult = await fastify.db.query(
          'SELECT password_hash FROM users WHERE id = $1',
          [request.user.id]
        );

        if (userResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
        }

        const passwordValid = await bcrypt.compare(password, userResult.rows[0].password_hash);
        if (!passwordValid) {
          fastify.log.warn({ userId: request.user.id, candidateId: id, field }, 'Reveal attempt with invalid password');
          return reply.status(403).send({ error: 'Forbidden', message: 'Invalid password' });
        }

        // Get candidate
        const column = FIELD_TO_COLUMN[field];
        const candidateResult = await fastify.db.query(
          `SELECT ${column} FROM candidates WHERE id = $1`,
          [id]
        );

        if (candidateResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Candidate not found' });
        }

        const encryptedValue = candidateResult.rows[0][column];
        if (!encryptedValue) {
          return reply.status(404).send({ error: 'Not Found', message: `Field "${field}" is not set for this candidate` });
        }

        const decryptedValue = decryptField(encryptedValue);

        await createAuditEntry(
          fastify.db,
          'candidate',
          id,
          'reveal_field',
          request.user.id,
          null,
          null,
          { field, revealed_at: new Date().toISOString() }
        );

        fastify.log.info({ userId: request.user.id, candidateId: id, field }, 'Sensitive field revealed');

        return reply.send({ field, value: decryptedValue });
      } catch (err) {
        fastify.log.error({ err, candidateId: id }, 'Failed to reveal field');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/candidates/:id/tags - add tag to candidate
  fastify.post<{ Params: CandidateParams; Body: TagBody }>(
    '/api/candidates/:id/tags',
    { schema: tagSchema, preHandler: [fastify.authorize('admin', 'recruiter')] },
    async (request: FastifyRequest<{ Params: CandidateParams; Body: TagBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { tagId } = request.body;

      try {
        // Object-level authorization first — prevents candidate-ID enumeration
        const access = await candidateAccess.checkCandidateAccess(fastify.db, id, request.user.id, request.user.role);
        if (!access.allowed) {
          return reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to this candidate\'s resources' });
        }

        // Verify candidate exists
        const candidateCheck = await fastify.db.query(
          'SELECT id FROM candidates WHERE id = $1',
          [id]
        );
        if (candidateCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Candidate not found' });
        }

        // Verify tag exists
        const tagCheck = await fastify.db.query(
          'SELECT id, name FROM tags WHERE id = $1',
          [tagId]
        );
        if (tagCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Tag not found' });
        }

        // Check if already assigned
        const existingCheck = await fastify.db.query(
          'SELECT candidate_id FROM candidate_tags WHERE candidate_id = $1 AND tag_id = $2',
          [id, tagId]
        );
        if (existingCheck.rows.length > 0) {
          return reply.status(409).send({ error: 'Conflict', message: 'Tag already assigned to this candidate' });
        }

        await fastify.db.query(
          'INSERT INTO candidate_tags (candidate_id, tag_id) VALUES ($1, $2)',
          [id, tagId]
        );

        await createAuditEntry(
          fastify.db,
          'candidate',
          id,
          'add_tag',
          request.user.id,
          null,
          { tag_id: tagId, tag_name: tagCheck.rows[0].name }
        );

        fastify.log.info({ candidateId: id, tagId }, 'Tag added to candidate');

        return reply.status(201).send({ candidate_id: id, tag_id: tagId, tag_name: tagCheck.rows[0].name });
      } catch (err) {
        fastify.log.error({ err, candidateId: id, tagId }, 'Failed to add tag to candidate');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // DELETE /api/candidates/:id/tags/:tagId - remove tag from candidate
  fastify.delete<{ Params: CandidateTagParams }>(
    '/api/candidates/:id/tags/:tagId',
    { preHandler: [fastify.authorize('admin', 'recruiter')] },
    async (request: FastifyRequest<{ Params: CandidateTagParams }>, reply: FastifyReply) => {
      const { id, tagId } = request.params;

      try {
        // Object-level authorization first — prevents candidate-ID enumeration
        const access = await candidateAccess.checkCandidateAccess(fastify.db, id, request.user.id, request.user.role);
        if (!access.allowed) {
          return reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to this candidate\'s resources' });
        }

        const result = await fastify.db.query(
          'DELETE FROM candidate_tags WHERE candidate_id = $1 AND tag_id = $2 RETURNING *',
          [id, tagId]
        );

        if (result.rowCount === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Tag assignment not found for this candidate' });
        }

        await createAuditEntry(
          fastify.db,
          'candidate',
          id,
          'remove_tag',
          request.user.id,
          { tag_id: tagId },
          null
        );

        fastify.log.info({ candidateId: id, tagId }, 'Tag removed from candidate');

        return reply.status(204).send();
      } catch (err) {
        fastify.log.error({ err, candidateId: id, tagId }, 'Failed to remove tag from candidate');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/candidates/:id/request-materials - request missing materials
  fastify.post<{ Params: CandidateParams; Body: RequestMaterialsBody }>(
    '/api/candidates/:id/request-materials',
    { schema: requestMaterialsSchema, preHandler: [fastify.authorize('admin', 'recruiter')] },
    async (request: FastifyRequest<{ Params: CandidateParams; Body: RequestMaterialsBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { message } = request.body;

      try {
        // Object-level authorization first — prevents candidate-ID enumeration
        const access = await candidateAccess.checkCandidateAccess(fastify.db, id, request.user.id, request.user.role);
        if (!access.allowed) {
          return reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to this candidate\'s resources' });
        }

        // Get candidate with project ownership to find the recruiter
        const candidateResult = await fastify.db.query(
          `SELECT c.*, jp.project_id, rp.created_by AS project_owner
           FROM candidates c
           LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
           LEFT JOIN recruiting_projects rp ON rp.id = jp.project_id
           WHERE c.id = $1`,
          [id]
        );

        if (candidateResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Candidate not found' });
        }

        const candidate = candidateResult.rows[0];

        // Find the recruiter via project ownership
        let recruiterId = candidate.project_owner;

        // Fall back to requesting user if no recruiter found
        if (!recruiterId) {
          recruiterId = request.user.id;
        }

        const notificationId = await createNotification(
          fastify.db,
          recruiterId,
          'materials_requested',
          {
            candidate_name: `${candidate.first_name} ${candidate.last_name}`,
            candidate_id: id,
            message,
            requested_by: request.user.username,
          }
        );

        await createAuditEntry(
          fastify.db,
          'candidate',
          id,
          'request_materials',
          request.user.id,
          null,
          null,
          { message, notification_id: notificationId, recruiter_id: recruiterId }
        );

        fastify.log.info({ candidateId: id, recruiterId, notificationId }, 'Materials request notification created');

        return reply.status(201).send({
          message: 'Materials request notification sent',
          notification_id: notificationId,
        });
      } catch (err) {
        fastify.log.error({ err, candidateId: id }, 'Failed to request materials');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );
}
