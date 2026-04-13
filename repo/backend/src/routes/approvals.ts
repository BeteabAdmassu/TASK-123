import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { processApprovalDecision } from '../services/approval-engine';
import { createAuditEntry } from '../services/audit.service';
import { createNotification } from '../services/notification.service';

interface CreateApprovalBody {
  template_id: string;
  entity_type: string;
  entity_id: string;
  final_write_back?: Record<string, unknown>;
}

interface StepDecisionBody {
  decision: 'approved' | 'rejected';
  comment?: string;
}

interface IdParam {
  id: string;
}

interface StepParams {
  id: string;
  stepId: string;
}

interface ListApprovalsQuery {
  page?: number;
  pageSize?: number;
  status?: string;
}

const createApprovalSchema = {
  body: {
    type: 'object',
    required: ['template_id', 'entity_type', 'entity_id'],
    properties: {
      template_id: { type: 'string', format: 'uuid' },
      entity_type: { type: 'string', minLength: 1, maxLength: 100 },
      entity_id: { type: 'string', format: 'uuid' },
      final_write_back: { type: 'object' },
    },
    additionalProperties: false,
  },
};

const stepDecisionSchema = {
  body: {
    type: 'object',
    required: ['decision'],
    properties: {
      decision: { type: 'string', enum: ['approved', 'rejected'] },
      comment: { type: 'string', maxLength: 2000 },
    },
    additionalProperties: false,
  },
};

const listApprovalsQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
    },
    additionalProperties: false,
  },
};

export default async function approvalRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/approvals - list approval requests
  fastify.get(
    '/api/approvals',
    {
      preHandler: [fastify.authenticate],
      schema: listApprovalsQuerySchema,
    },
    async (
      request: FastifyRequest<{ Querystring: ListApprovalsQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const page = request.query.page || 1;
        const pageSize = request.query.pageSize || 25;
        const offset = (page - 1) * pageSize;
        const status = request.query.status;
        const userId = request.user.id;
        const userRole = request.user.role;

        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (status) {
          conditions.push(`ar.status = $${paramIndex}`);
          params.push(status);
          paramIndex++;
        }

        // Approvers see requests with steps assigned to them; others see their own requests
        if (userRole === 'approver') {
          conditions.push(`EXISTS (SELECT 1 FROM approval_steps s WHERE s.request_id = ar.id AND s.approver_id = $${paramIndex})`);
          params.push(userId);
          paramIndex++;
        } else if (userRole !== 'admin') {
          conditions.push(`ar.requested_by = $${paramIndex}`);
          params.push(userId);
          paramIndex++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await fastify.db.query(
          `SELECT COUNT(*) AS total FROM approval_requests ar ${whereClause}`,
          params,
        );
        const total = parseInt(countResult.rows[0].total, 10);

        const dataParams = [...params, pageSize, offset];
        const dataResult = await fastify.db.query(
          `SELECT ar.id, ar.template_id, ar.entity_type, ar.entity_id, ar.requested_by,
                  ar.approval_mode, ar.status, ar.final_write_back, ar.created_at, ar.updated_at
           FROM approval_requests ar
           ${whereClause}
           ORDER BY ar.created_at DESC
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
        fastify.log.error(err, 'Failed to list approval requests');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list approval requests' });
      }
    },
  );

  // POST /api/approvals - create approval request
  fastify.post<{ Body: CreateApprovalBody }>(
    '/api/approvals',
    {
      preHandler: [fastify.authorize('recruiter', 'admin')],
      schema: createApprovalSchema,
    },
    async (request: FastifyRequest<{ Body: CreateApprovalBody }>, reply: FastifyReply) => {
      const { template_id, entity_type, entity_id, final_write_back } = request.body;
      const requestedBy = request.user.id;

      const client = await fastify.db.connect();
      try {
        await client.query('BEGIN');

        // Fetch template and its steps
        const templateResult = await client.query(
          'SELECT id, approval_mode FROM approval_templates WHERE id = $1 AND is_active = true',
          [template_id],
        );

        if (templateResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Not Found', message: 'Approval template not found or inactive' });
        }

        const template = templateResult.rows[0];

        const templateStepsResult = await client.query(
          'SELECT step_order, approver_id FROM approval_template_steps WHERE template_id = $1 ORDER BY step_order ASC',
          [template_id],
        );

        if (templateStepsResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Bad Request', message: 'Template has no approval steps defined' });
        }

        // Create the approval request
        const requestResult = await client.query(
          `INSERT INTO approval_requests (template_id, entity_type, entity_id, requested_by, approval_mode, final_write_back)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, template_id, entity_type, entity_id, requested_by, approval_mode, status, final_write_back, created_at, updated_at`,
          [template_id, entity_type, entity_id, requestedBy, template.approval_mode, final_write_back ? JSON.stringify(final_write_back) : null],
        );

        const approvalRequest = requestResult.rows[0];

        // Copy template steps into approval_steps
        const insertedSteps = [];
        for (const step of templateStepsResult.rows) {
          const stepResult = await client.query(
            `INSERT INTO approval_steps (request_id, step_order, approver_id)
             VALUES ($1, $2, $3)
             RETURNING id, request_id, step_order, approver_id, status, comment, decided_at, created_at`,
            [approvalRequest.id, step.step_order, step.approver_id],
          );
          insertedSteps.push(stepResult.rows[0]);
        }

        await client.query('COMMIT');

        // Audit the creation
        await createAuditEntry(fastify.db, 'approval_request', approvalRequest.id, 'request_created', requestedBy, null, {
          template_id, entity_type, entity_id,
        });

        // Notify each approver
        for (const step of insertedSteps) {
          try {
            await createNotification(fastify.db, step.approver_id, 'approval_requested', {
              request_id: approvalRequest.id,
              entity_type,
              entity_id,
              requested_by: requestedBy,
            });
          } catch {
            // Non-critical: notification failure should not block approval creation
            fastify.log.warn({ stepId: step.id, approverId: step.approver_id }, 'Failed to send approval notification');
          }
        }

        fastify.log.info({ requestId: approvalRequest.id, requestedBy }, 'Approval request created');
        return reply.status(201).send({ ...approvalRequest, steps: insertedSteps });
      } catch (err) {
        await client.query('ROLLBACK');
        fastify.log.error(err, 'Failed to create approval request');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to create approval request' });
      } finally {
        client.release();
      }
    },
  );

  // GET /api/approvals/:id - get request with all steps
  fastify.get<{ Params: IdParam }>(
    '/api/approvals/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;

        const requestResult = await fastify.db.query(
          `SELECT id, template_id, entity_type, entity_id, requested_by, approval_mode, status,
                  final_write_back, created_at, updated_at
           FROM approval_requests
           WHERE id = $1`,
          [id],
        );

        if (requestResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Approval request not found' });
        }

        const stepsResult = await fastify.db.query(
          `SELECT id, request_id, step_order, approver_id, status, comment,
                  attachment_path, attachment_size, decided_at, created_at
           FROM approval_steps
           WHERE request_id = $1
           ORDER BY step_order ASC`,
          [id],
        );

        return reply.status(200).send({ ...requestResult.rows[0], steps: stepsResult.rows });
      } catch (err) {
        fastify.log.error(err, 'Failed to get approval request');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get approval request' });
      }
    },
  );

  // PUT /api/approvals/:id/steps/:stepId - approve/reject step
  fastify.put<{ Params: StepParams; Body: StepDecisionBody }>(
    '/api/approvals/:id/steps/:stepId',
    {
      preHandler: [fastify.authorize('approver', 'admin')],
      schema: stepDecisionSchema,
    },
    async (request: FastifyRequest<{ Params: StepParams; Body: StepDecisionBody }>, reply: FastifyReply) => {
      try {
        const { id, stepId } = request.params;
        const { decision, comment } = request.body;
        const userId = request.user.id;

        const result = await processApprovalDecision(
          fastify.db,
          id,
          stepId,
          userId,
          decision,
          comment || null,
        );

        fastify.log.info({ requestId: id, stepId, decision, userId }, 'Approval step decided');
        return reply.status(200).send({
          message: `Step ${decision}`,
          requestStatus: result.requestStatus,
          completed: result.completed,
        });
      } catch (err: unknown) {
        const error = err as { statusCode?: number; message?: string };
        if (error.statusCode) {
          return reply.status(error.statusCode).send({ error: 'Error', message: error.message });
        }
        fastify.log.error(err, 'Failed to process approval decision');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to process approval decision' });
      }
    },
  );

  // GET /api/approvals/:id/audit - get audit trail entries for this approval request
  fastify.get<{ Params: IdParam }>(
    '/api/approvals/:id/audit',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;

        // Verify the approval request exists
        const requestResult = await fastify.db.query(
          'SELECT id FROM approval_requests WHERE id = $1',
          [id],
        );

        if (requestResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Approval request not found' });
        }

        // Get audit entries for the approval request and its steps
        const auditResult = await fastify.db.query(
          `SELECT id, entity_type, entity_id, action, actor_id, before_state, after_state, metadata, created_at
           FROM audit_trail
           WHERE (entity_type = 'approval_request' AND entity_id = $1)
              OR (entity_type = 'approval_step' AND entity_id IN (
                SELECT id FROM approval_steps WHERE request_id = $1
              ))
           ORDER BY created_at ASC`,
          [id],
        );

        return reply.status(200).send({ data: auditResult.rows });
      } catch (err) {
        fastify.log.error(err, 'Failed to get approval audit trail');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get approval audit trail' });
      }
    },
  );
}
