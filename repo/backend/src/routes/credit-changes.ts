import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createAuditEntry } from '../services/audit.service';

interface CreditChangeBody {
  entity_type: string;
  entity_id: string;
  amount: number;
  reason: string;
  template_id?: string;
}

interface IdParam {
  id: string;
}

interface CreditChangeQuery {
  page?: string;
  pageSize?: string;
  status?: string;
}

const creditChangeBodySchema = {
  body: {
    type: 'object',
    required: ['entity_type', 'entity_id', 'amount', 'reason'],
    properties: {
      entity_type: { type: 'string', minLength: 1, maxLength: 100 },
      entity_id: { type: 'string', format: 'uuid' },
      amount: { type: 'number' },
      reason: { type: 'string', minLength: 1 },
      template_id: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  },
};

export default async function creditChangesRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/credit-changes - list credit changes (paginated, filter by status)
  // Object-level: admin sees all; others see only their own requests or ones they're approving
  fastify.get<{ Querystring: CreditChangeQuery }>(
    '/api/credit-changes',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Querystring: CreditChangeQuery }>, reply: FastifyReply) => {
      const page = Math.max(1, parseInt(request.query.page || '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(request.query.pageSize || '20', 10) || 20));
      const offset = (page - 1) * pageSize;
      const { status } = request.query;
      const userId = request.user.id;
      const userRole = request.user.role;

      try {
        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (status) {
          conditions.push(`cc.status = $${paramIdx++}`);
          params.push(status);
        }

        // Non-admin: restrict to own requests or requests with assigned approval steps
        if (userRole !== 'admin') {
          conditions.push(`(cc.requested_by = $${paramIdx} OR EXISTS (
            SELECT 1 FROM approval_requests ar
            JOIN approval_steps ast ON ast.request_id = ar.id
            WHERE ar.entity_type = 'credit_change' AND ar.entity_id = cc.id::text
            AND ast.approver_id = $${paramIdx}
          ))`);
          params.push(userId);
          paramIdx++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await fastify.db.query(
          `SELECT COUNT(*) FROM credit_changes cc ${whereClause}`,
          params
        );
        const total = parseInt(countResult.rows[0].count, 10);

        const dataResult = await fastify.db.query(
          `SELECT cc.*, u.username AS requested_by_username
           FROM credit_changes cc
           LEFT JOIN users u ON u.id = cc.requested_by
           ${whereClause}
           ORDER BY cc.created_at DESC
           LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
          [...params, pageSize, offset]
        );

        return reply.send({
          data: dataResult.rows,
          total,
          page,
          pageSize,
        });
      } catch (err) {
        fastify.log.error({ err }, 'Failed to list credit changes');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/credit-changes - create credit change (recruiter, admin)
  fastify.post<{ Body: CreditChangeBody }>(
    '/api/credit-changes',
    { schema: creditChangeBodySchema, preHandler: [fastify.authorize('recruiter', 'admin')] },
    async (request: FastifyRequest<{ Body: CreditChangeBody }>, reply: FastifyReply) => {
      const { entity_type, entity_id, amount, reason, template_id } = request.body;
      const requestedBy = request.user.id;

      try {
        // Insert the credit change
        const result = await fastify.db.query(
          `INSERT INTO credit_changes (entity_type, entity_id, amount, reason, requested_by, status)
           VALUES ($1, $2, $3, $4, $5, 'pending_approval') RETURNING *`,
          [entity_type, entity_id, amount, reason, requestedBy]
        );

        const creditChange = result.rows[0];

        await createAuditEntry(
          fastify.db, 'credit_change', creditChange.id, 'created',
          requestedBy, null, creditChange
        );

        // If template_id is provided, auto-create an approval request
        if (template_id) {
          const templateResult = await fastify.db.query(
            'SELECT * FROM approval_templates WHERE id = $1 AND is_active = true',
            [template_id]
          );

          if (templateResult.rows.length === 0) {
            // Credit change is still created, but we warn about the template
            fastify.log.warn({ templateId: template_id }, 'Approval template not found or inactive');
            return reply.status(201).send({
              ...creditChange,
              approval_warning: 'Approval template not found or inactive; no approval request was created',
            });
          }

          const template = templateResult.rows[0];

          // Create the approval request
          const approvalResult = await fastify.db.query(
            `INSERT INTO approval_requests (template_id, entity_type, entity_id, requested_by, approval_mode, status)
             VALUES ($1, 'credit_change', $2, $3, $4, 'pending') RETURNING *`,
            [template_id, creditChange.id, requestedBy, template.approval_mode]
          );

          const approvalRequest = approvalResult.rows[0];

          // Copy steps from template
          const templateSteps = await fastify.db.query(
            'SELECT * FROM approval_template_steps WHERE template_id = $1 ORDER BY step_order',
            [template_id]
          );

          for (const step of templateSteps.rows) {
            await fastify.db.query(
              `INSERT INTO approval_steps (request_id, step_order, approver_id, status)
               VALUES ($1, $2, $3, 'pending')`,
              [approvalRequest.id, step.step_order, step.approver_id]
            );
          }

          await createAuditEntry(
            fastify.db, 'approval_request', approvalRequest.id, 'auto_created',
            requestedBy, null, { credit_change_id: creditChange.id, template_id }
          );

          fastify.log.info(
            { creditChangeId: creditChange.id, approvalRequestId: approvalRequest.id },
            'Credit change created with auto-approval request'
          );

          return reply.status(201).send({
            ...creditChange,
            approval_request_id: approvalRequest.id,
          });
        }

        fastify.log.info({ creditChangeId: creditChange.id }, 'Credit change created');
        return reply.status(201).send(creditChange);
      } catch (err) {
        fastify.log.error({ err }, 'Failed to create credit change');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // GET /api/credit-changes/:id - get credit change detail
  // Object-level auth: requester, assigned approver, or admin can view
  fastify.get<{ Params: IdParam }>(
    '/api/credit-changes/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
      const { id } = request.params;
      const userId = request.user.id;
      const userRole = request.user.role;

      try {
        const result = await fastify.db.query(
          `SELECT cc.*, u.username AS requested_by_username
           FROM credit_changes cc
           LEFT JOIN users u ON u.id = cc.requested_by
           WHERE cc.id = $1`,
          [id]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Credit change not found' });
        }

        const creditChange = result.rows[0];

        // Object-level access: admin sees all; others must be requester or assigned approver
        if (userRole !== 'admin') {
          const isRequester = creditChange.requested_by === userId;
          const isApprover = await fastify.db.query(
            `SELECT 1 FROM approval_requests ar
             JOIN approval_steps ast ON ast.request_id = ar.id
             WHERE ar.entity_type = 'credit_change' AND ar.entity_id = $1 AND ast.approver_id = $2
             LIMIT 1`,
            [id, userId]
          );
          if (!isRequester && isApprover.rows.length === 0) {
            return reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to this credit change' });
          }
        }

        // Fetch related approval requests
        const approvalResult = await fastify.db.query(
          `SELECT ar.*, at.name AS template_name
           FROM approval_requests ar
           LEFT JOIN approval_templates at ON at.id = ar.template_id
           WHERE ar.entity_type = 'credit_change' AND ar.entity_id = $1
           ORDER BY ar.created_at DESC`,
          [id]
        );

        return reply.send({
          ...creditChange,
          approval_requests: approvalResult.rows,
        });
      } catch (err) {
        fastify.log.error({ err, creditChangeId: id }, 'Failed to get credit change');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );
}
