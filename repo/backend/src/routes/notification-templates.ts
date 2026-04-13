import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface CreateNotificationTemplateBody {
  template_key: string;
  subject: string;
  body: string;
  channel: 'in_app' | 'email_export' | 'sms_export';
}

interface UpdateNotificationTemplateBody {
  template_key?: string;
  subject?: string;
  body?: string;
  channel?: 'in_app' | 'email_export' | 'sms_export';
  is_active?: boolean;
}

interface IdParam {
  id: string;
}

const createNotificationTemplateSchema = {
  body: {
    type: 'object',
    required: ['template_key', 'subject', 'body', 'channel'],
    properties: {
      template_key: { type: 'string', minLength: 1, maxLength: 100 },
      subject: { type: 'string', minLength: 1, maxLength: 255 },
      body: { type: 'string', minLength: 1 },
      channel: { type: 'string', enum: ['in_app', 'email_export', 'sms_export'] },
    },
    additionalProperties: false,
  },
};

const updateNotificationTemplateSchema = {
  body: {
    type: 'object',
    properties: {
      template_key: { type: 'string', minLength: 1, maxLength: 100 },
      subject: { type: 'string', minLength: 1, maxLength: 255 },
      body: { type: 'string', minLength: 1 },
      channel: { type: 'string', enum: ['in_app', 'email_export', 'sms_export'] },
      is_active: { type: 'boolean' },
    },
    additionalProperties: false,
    minProperties: 1,
  },
};

export default async function notificationTemplateRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/notification-templates - list templates
  fastify.get(
    '/api/notification-templates',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await fastify.db.query(
          `SELECT id, template_key, subject, body, channel, is_active, created_at, updated_at
           FROM notification_templates
           ORDER BY created_at DESC`,
        );

        return reply.status(200).send({ data: result.rows });
      } catch (err) {
        fastify.log.error(err, 'Failed to list notification templates');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list notification templates' });
      }
    },
  );

  // POST /api/notification-templates - create template
  fastify.post<{ Body: CreateNotificationTemplateBody }>(
    '/api/notification-templates',
    {
      preHandler: [fastify.authorize('admin')],
      schema: createNotificationTemplateSchema,
    },
    async (request: FastifyRequest<{ Body: CreateNotificationTemplateBody }>, reply: FastifyReply) => {
      const { template_key, subject, body, channel } = request.body;

      try {
        // Check for duplicate template_key
        const existing = await fastify.db.query(
          'SELECT id FROM notification_templates WHERE template_key = $1',
          [template_key],
        );

        if (existing.rows.length > 0) {
          return reply.status(409).send({ error: 'Conflict', message: 'A notification template with this key already exists' });
        }

        const result = await fastify.db.query(
          `INSERT INTO notification_templates (template_key, subject, body, channel)
           VALUES ($1, $2, $3, $4)
           RETURNING id, template_key, subject, body, channel, is_active, created_at, updated_at`,
          [template_key, subject, body, channel],
        );

        fastify.log.info({ templateId: result.rows[0].id, template_key }, 'Notification template created');
        return reply.status(201).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to create notification template');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to create notification template' });
      }
    },
  );

  // PUT /api/notification-templates/:id - update template
  fastify.put<{ Params: IdParam; Body: UpdateNotificationTemplateBody }>(
    '/api/notification-templates/:id',
    {
      preHandler: [fastify.authorize('admin')],
      schema: updateNotificationTemplateSchema,
    },
    async (request: FastifyRequest<{ Params: IdParam; Body: UpdateNotificationTemplateBody }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;
        const { template_key, subject, body, channel, is_active } = request.body;

        const existing = await fastify.db.query(
          'SELECT id FROM notification_templates WHERE id = $1',
          [id],
        );

        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Notification template not found' });
        }

        // If updating template_key, check for duplicates
        if (template_key !== undefined) {
          const duplicate = await fastify.db.query(
            'SELECT id FROM notification_templates WHERE template_key = $1 AND id != $2',
            [template_key, id],
          );
          if (duplicate.rows.length > 0) {
            return reply.status(409).send({ error: 'Conflict', message: 'A notification template with this key already exists' });
          }
        }

        const setClauses: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (template_key !== undefined) {
          setClauses.push(`template_key = $${paramIndex}`);
          params.push(template_key);
          paramIndex++;
        }
        if (subject !== undefined) {
          setClauses.push(`subject = $${paramIndex}`);
          params.push(subject);
          paramIndex++;
        }
        if (body !== undefined) {
          setClauses.push(`body = $${paramIndex}`);
          params.push(body);
          paramIndex++;
        }
        if (channel !== undefined) {
          setClauses.push(`channel = $${paramIndex}`);
          params.push(channel);
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
          `UPDATE notification_templates
           SET ${setClauses.join(', ')}
           WHERE id = $${paramIndex}
           RETURNING id, template_key, subject, body, channel, is_active, created_at, updated_at`,
          params,
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Notification template not found' });
        }

        fastify.log.info({ templateId: id }, 'Notification template updated');
        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to update notification template');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update notification template' });
      }
    },
  );

  // DELETE /api/notification-templates/:id - deactivate (set is_active=false)
  fastify.delete<{ Params: IdParam }>(
    '/api/notification-templates/:id',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;

        const result = await fastify.db.query(
          `UPDATE notification_templates
           SET is_active = false, updated_at = NOW()
           WHERE id = $1 AND is_active = true
           RETURNING id`,
          [id],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Notification template not found or already deactivated' });
        }

        fastify.log.info({ templateId: id }, 'Notification template deactivated');
        return reply.status(200).send({ message: 'Notification template deactivated successfully' });
      } catch (err) {
        fastify.log.error(err, 'Failed to deactivate notification template');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to deactivate notification template' });
      }
    },
  );
}
