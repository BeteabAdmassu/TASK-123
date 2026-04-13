import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { scanCandidate } from '../services/violation-scanner';
import { createAuditEntry } from '../services/audit.service';

interface IdParam {
  id: string;
}

interface ListViolationsQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  severity?: string;
}

interface ReviewBody {
  decision: string;
  review_comment: string;
}

interface CreateRuleBody {
  rule_type: string;
  rule_config: Record<string, unknown>;
  severity: string;
}

interface UpdateRuleBody {
  rule_type?: string;
  rule_config?: Record<string, unknown>;
  severity?: string;
  is_active?: boolean;
}

const listViolationsQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      status: { type: 'string', enum: ['pending', 'reviewed', 'dismissed', 'escalated'] },
      severity: { type: 'string', enum: ['warning', 'error', 'critical'] },
    },
    additionalProperties: false,
  },
};

const reviewSchema = {
  body: {
    type: 'object',
    required: ['decision', 'review_comment'],
    properties: {
      decision: { type: 'string', minLength: 1, maxLength: 50 },
      review_comment: { type: 'string', minLength: 1, maxLength: 2000 },
    },
    additionalProperties: false,
  },
};

const createRuleSchema = {
  body: {
    type: 'object',
    required: ['rule_type', 'rule_config', 'severity'],
    properties: {
      rule_type: { type: 'string', enum: ['prohibited_phrase', 'missing_field', 'duplicate_pattern', 'custom'] },
      rule_config: { type: 'object' },
      severity: { type: 'string', enum: ['warning', 'error', 'critical'] },
    },
    additionalProperties: false,
  },
};

const updateRuleSchema = {
  body: {
    type: 'object',
    properties: {
      rule_type: { type: 'string', enum: ['prohibited_phrase', 'missing_field', 'duplicate_pattern', 'custom'] },
      rule_config: { type: 'object' },
      severity: { type: 'string', enum: ['warning', 'error', 'critical'] },
      is_active: { type: 'boolean' },
    },
    additionalProperties: false,
    minProperties: 1,
  },
};

export default async function violationRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/violations - list violation queue (paginated, filter by status, severity)
  fastify.get(
    '/api/violations',
    {
      preHandler: [fastify.authorize('reviewer', 'admin')],
      schema: listViolationsQuerySchema,
    },
    async (
      request: FastifyRequest<{ Querystring: ListViolationsQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const page = request.query.page || 1;
        const pageSize = request.query.pageSize || 25;
        const offset = (page - 1) * pageSize;

        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (request.query.status) {
          conditions.push(`vi.status = $${paramIndex}`);
          params.push(request.query.status);
          paramIndex++;
        }

        if (request.query.severity) {
          conditions.push(`vr.severity = $${paramIndex}`);
          params.push(request.query.severity);
          paramIndex++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await fastify.db.query(
          `SELECT COUNT(*) AS total
           FROM violation_instances vi
           JOIN violation_rules vr ON vr.id = vi.rule_id
           ${whereClause}`,
          params,
        );
        const total = parseInt(countResult.rows[0].total, 10);

        const dataParams = [...params, pageSize, offset];
        const dataResult = await fastify.db.query(
          `SELECT vi.id, vi.candidate_id, vi.rule_id, vi.details, vi.status,
                  vi.reviewed_by, vi.decision, vi.review_comment, vi.reviewed_at, vi.created_at,
                  vr.rule_type, vr.severity
           FROM violation_instances vi
           JOIN violation_rules vr ON vr.id = vi.rule_id
           ${whereClause}
           ORDER BY vi.created_at DESC
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          dataParams,
        );

        return reply.status(200).send({
          data: dataResult.rows,
          total,
          page,
          pageSize,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to list violations');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list violations' });
      }
    },
  );

  // GET /api/violations/rules - list rules (must be before /:id to avoid route conflict)
  fastify.get(
    '/api/violations/rules',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await fastify.db.query(
          'SELECT id, rule_type, rule_config, severity, is_active, created_at FROM violation_rules ORDER BY created_at DESC',
        );
        return reply.status(200).send({ data: result.rows });
      } catch (err) {
        fastify.log.error(err, 'Failed to list violation rules');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list violation rules' });
      }
    },
  );

  // POST /api/violations/rules - create rule
  fastify.post(
    '/api/violations/rules',
    {
      preHandler: [fastify.authorize('admin')],
      schema: createRuleSchema,
    },
    async (
      request: FastifyRequest<{ Body: CreateRuleBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const { rule_type, rule_config, severity } = request.body;

        const result = await fastify.db.query(
          `INSERT INTO violation_rules (rule_type, rule_config, severity)
           VALUES ($1, $2, $3)
           RETURNING id, rule_type, rule_config, severity, is_active, created_at`,
          [rule_type, JSON.stringify(rule_config), severity],
        );

        fastify.log.info({ ruleId: result.rows[0].id }, 'Violation rule created');
        return reply.status(201).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to create violation rule');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to create violation rule' });
      }
    },
  );

  // PUT /api/violations/rules/:id - update rule
  fastify.put(
    '/api/violations/rules/:id',
    {
      preHandler: [fastify.authorize('admin')],
      schema: updateRuleSchema,
    },
    async (
      request: FastifyRequest<{ Params: IdParam; Body: UpdateRuleBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        const { rule_type, rule_config, severity, is_active } = request.body;

        const existing = await fastify.db.query(
          'SELECT id FROM violation_rules WHERE id = $1',
          [id],
        );

        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Violation rule not found' });
        }

        const setClauses: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (rule_type !== undefined) {
          setClauses.push(`rule_type = $${paramIndex}`);
          params.push(rule_type);
          paramIndex++;
        }
        if (rule_config !== undefined) {
          setClauses.push(`rule_config = $${paramIndex}`);
          params.push(JSON.stringify(rule_config));
          paramIndex++;
        }
        if (severity !== undefined) {
          setClauses.push(`severity = $${paramIndex}`);
          params.push(severity);
          paramIndex++;
        }
        if (is_active !== undefined) {
          setClauses.push(`is_active = $${paramIndex}`);
          params.push(is_active);
          paramIndex++;
        }

        if (setClauses.length === 0) {
          return reply.status(400).send({ error: 'Bad Request', message: 'No fields to update' });
        }

        params.push(id);
        const result = await fastify.db.query(
          `UPDATE violation_rules
           SET ${setClauses.join(', ')}
           WHERE id = $${paramIndex}
           RETURNING id, rule_type, rule_config, severity, is_active, created_at`,
          params,
        );

        fastify.log.info({ ruleId: id }, 'Violation rule updated');
        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to update violation rule');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update violation rule' });
      }
    },
  );

  // GET /api/violations/:id - get violation detail with rule info
  fastify.get(
    '/api/violations/:id',
    {
      preHandler: [fastify.authorize('reviewer', 'admin')],
    },
    async (
      request: FastifyRequest<{ Params: IdParam }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;

        const result = await fastify.db.query(
          `SELECT vi.id, vi.candidate_id, vi.rule_id, vi.details, vi.status,
                  vi.reviewed_by, vi.decision, vi.review_comment, vi.reviewed_at, vi.created_at,
                  vr.rule_type, vr.rule_config, vr.severity, vr.is_active
           FROM violation_instances vi
           JOIN violation_rules vr ON vr.id = vi.rule_id
           WHERE vi.id = $1`,
          [id],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Violation not found' });
        }

        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to get violation detail');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get violation detail' });
      }
    },
  );

  // PUT /api/violations/:id/review - submit review
  fastify.put(
    '/api/violations/:id/review',
    {
      preHandler: [fastify.authorize('reviewer')],
      schema: reviewSchema,
    },
    async (
      request: FastifyRequest<{ Params: IdParam; Body: ReviewBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        const { decision, review_comment } = request.body;

        const existing = await fastify.db.query(
          'SELECT id, status, candidate_id FROM violation_instances WHERE id = $1',
          [id],
        );

        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Violation not found' });
        }

        const beforeState = existing.rows[0];

        const result = await fastify.db.query(
          `UPDATE violation_instances
           SET decision = $1, review_comment = $2, reviewed_by = $3, reviewed_at = NOW(), status = 'reviewed'
           WHERE id = $4
           RETURNING id, candidate_id, rule_id, details, status, reviewed_by, decision, review_comment, reviewed_at, created_at`,
          [decision, review_comment, request.user.id, id],
        );

        await createAuditEntry(
          fastify.db,
          'violation_instance',
          id,
          'review',
          request.user.id,
          beforeState,
          result.rows[0],
          { decision, review_comment },
        );

        fastify.log.info({ violationId: id, reviewedBy: request.user.id }, 'Violation reviewed');
        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to review violation');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to review violation' });
      }
    },
  );

  // POST /api/candidates/:id/scan - trigger violation scan for candidate
  fastify.post(
    '/api/candidates/:id/scan',
    {
      preHandler: [fastify.authorize('recruiter', 'admin')],
    },
    async (
      request: FastifyRequest<{ Params: IdParam }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;

        // Verify candidate exists
        const candidateResult = await fastify.db.query(
          'SELECT id FROM candidates WHERE id = $1',
          [id],
        );

        if (candidateResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Candidate not found' });
        }

        const violations = await scanCandidate(fastify.db, id);

        fastify.log.info({ candidateId: id, violationCount: violations.length }, 'Candidate scan completed');
        return reply.status(200).send({
          candidateId: id,
          violationsFound: violations.length,
          violations,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to scan candidate');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to scan candidate' });
      }
    },
  );
}
