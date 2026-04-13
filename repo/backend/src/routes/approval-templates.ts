import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface CreateTemplateBody {
  name: string;
  description?: string;
  approval_mode: 'joint' | 'any';
  steps: { step_order: number; approver_id: string }[];
}

interface UpdateTemplateBody {
  name?: string;
  description?: string;
  approval_mode?: 'joint' | 'any';
  is_active?: boolean;
}

interface IdParam {
  id: string;
}

const createTemplateSchema = {
  body: {
    type: 'object',
    required: ['name', 'approval_mode', 'steps'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 2000 },
      approval_mode: { type: 'string', enum: ['joint', 'any'] },
      steps: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['step_order', 'approver_id'],
          properties: {
            step_order: { type: 'integer', minimum: 1 },
            approver_id: { type: 'string', format: 'uuid' },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
};

const updateTemplateSchema = {
  body: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 2000 },
      approval_mode: { type: 'string', enum: ['joint', 'any'] },
      is_active: { type: 'boolean' },
    },
    additionalProperties: false,
    minProperties: 1,
  },
};

export default async function approvalTemplateRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/approval-templates - list templates
  fastify.get(
    '/api/approval-templates',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await fastify.db.query(
          `SELECT id, name, description, approval_mode, is_active, created_by, created_at, updated_at
           FROM approval_templates
           ORDER BY created_at DESC`,
        );

        return reply.status(200).send({ data: result.rows });
      } catch (err) {
        fastify.log.error(err, 'Failed to list approval templates');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list approval templates' });
      }
    },
  );

  // POST /api/approval-templates - create template with steps in transaction
  fastify.post<{ Body: CreateTemplateBody }>(
    '/api/approval-templates',
    {
      preHandler: [fastify.authorize('admin')],
      schema: createTemplateSchema,
    },
    async (request: FastifyRequest<{ Body: CreateTemplateBody }>, reply: FastifyReply) => {
      const { name, description, approval_mode, steps } = request.body;
      const createdBy = request.user.id;

      const client = await fastify.db.connect();
      try {
        await client.query('BEGIN');

        const templateResult = await client.query(
          `INSERT INTO approval_templates (name, description, approval_mode, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, description, approval_mode, is_active, created_by, created_at, updated_at`,
          [name, description || null, approval_mode, createdBy],
        );

        const template = templateResult.rows[0];

        const insertedSteps = [];
        for (const step of steps) {
          const stepResult = await client.query(
            `INSERT INTO approval_template_steps (template_id, step_order, approver_id)
             VALUES ($1, $2, $3)
             RETURNING id, template_id, step_order, approver_id, created_at`,
            [template.id, step.step_order, step.approver_id],
          );
          insertedSteps.push(stepResult.rows[0]);
        }

        await client.query('COMMIT');

        fastify.log.info({ templateId: template.id, createdBy }, 'Approval template created');
        return reply.status(201).send({ ...template, steps: insertedSteps });
      } catch (err) {
        await client.query('ROLLBACK');
        fastify.log.error(err, 'Failed to create approval template');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to create approval template' });
      } finally {
        client.release();
      }
    },
  );

  // GET /api/approval-templates/:id - get template with steps
  fastify.get<{ Params: IdParam }>(
    '/api/approval-templates/:id',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;

        const templateResult = await fastify.db.query(
          `SELECT id, name, description, approval_mode, is_active, created_by, created_at, updated_at
           FROM approval_templates
           WHERE id = $1`,
          [id],
        );

        if (templateResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Approval template not found' });
        }

        const stepsResult = await fastify.db.query(
          `SELECT id, template_id, step_order, approver_id, created_at
           FROM approval_template_steps
           WHERE template_id = $1
           ORDER BY step_order ASC`,
          [id],
        );

        return reply.status(200).send({ ...templateResult.rows[0], steps: stepsResult.rows });
      } catch (err) {
        fastify.log.error(err, 'Failed to get approval template');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get approval template' });
      }
    },
  );

  // PUT /api/approval-templates/:id - update template
  fastify.put<{ Params: IdParam; Body: UpdateTemplateBody }>(
    '/api/approval-templates/:id',
    {
      preHandler: [fastify.authorize('admin')],
      schema: updateTemplateSchema,
    },
    async (request: FastifyRequest<{ Params: IdParam; Body: UpdateTemplateBody }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;
        const { name, description, approval_mode, is_active } = request.body;

        const existing = await fastify.db.query(
          'SELECT id FROM approval_templates WHERE id = $1',
          [id],
        );

        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Approval template not found' });
        }

        const setClauses: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (name !== undefined) {
          setClauses.push(`name = $${paramIndex}`);
          params.push(name);
          paramIndex++;
        }
        if (description !== undefined) {
          setClauses.push(`description = $${paramIndex}`);
          params.push(description);
          paramIndex++;
        }
        if (approval_mode !== undefined) {
          setClauses.push(`approval_mode = $${paramIndex}`);
          params.push(approval_mode);
          paramIndex++;
        }
        if (is_active !== undefined) {
          setClauses.push(`is_active = $${paramIndex}`);
          params.push(is_active);
          paramIndex++;
        }

        setClauses.push('updated_at = NOW()');

        params.push(id);
        const result = await fastify.db.query(
          `UPDATE approval_templates
           SET ${setClauses.join(', ')}
           WHERE id = $${paramIndex}
           RETURNING id, name, description, approval_mode, is_active, created_by, created_at, updated_at`,
          params,
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Approval template not found' });
        }

        fastify.log.info({ templateId: id }, 'Approval template updated');
        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to update approval template');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update approval template' });
      }
    },
  );

  // DELETE /api/approval-templates/:id - deactivate (set is_active=false)
  fastify.delete<{ Params: IdParam }>(
    '/api/approval-templates/:id',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;

        const result = await fastify.db.query(
          `UPDATE approval_templates
           SET is_active = false, updated_at = NOW()
           WHERE id = $1 AND is_active = true
           RETURNING id`,
          [id],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Approval template not found or already deactivated' });
        }

        fastify.log.info({ templateId: id }, 'Approval template deactivated');
        return reply.status(200).send({ message: 'Approval template deactivated successfully' });
      } catch (err) {
        fastify.log.error(err, 'Failed to deactivate approval template');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to deactivate approval template' });
      }
    },
  );
}
