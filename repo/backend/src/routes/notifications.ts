import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateExportFile } from '../services/notification.service';
import { NOTIFICATIONS } from '../../../shared/api-contracts';
import { apiPath } from '../../../shared/contract-utils';

interface IdParam {
  id: string;
}

interface ListNotificationsQuery {
  page?: number;
  pageSize?: number;
}

const listNotificationsQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
    additionalProperties: false,
  },
};

export default async function notificationRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/notifications - list user's notifications (paginated)
  fastify.get(
    '/api/notifications',
    {
      preHandler: [fastify.authenticate],
      schema: listNotificationsQuerySchema,
    },
    async (
      request: FastifyRequest<{ Querystring: ListNotificationsQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const page = request.query.page || 1;
        const pageSize = request.query.pageSize || 25;
        const offset = (page - 1) * pageSize;
        const userId = request.user.id;

        const countResult = await fastify.db.query(
          'SELECT COUNT(*) AS total FROM notification_tasks WHERE recipient_id = $1',
          [userId],
        );
        const total = parseInt(countResult.rows[0].total, 10);

        const dataResult = await fastify.db.query(
          `SELECT id, recipient_id, type, template_key, template_vars, rendered_content,
                  status, retry_count, max_retries, export_path, created_at, updated_at
           FROM notification_tasks
           WHERE recipient_id = $1
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [userId, pageSize, offset],
        );

        return reply.status(200).send({
          data: dataResult.rows,
          total,
          page,
          pageSize,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to list notifications');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list notifications' });
      }
    },
  );

  // PUT /api/notifications/:id/read - mark as 'opened'
  fastify.put<{ Params: IdParam }>(
    '/api/notifications/:id/read',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;
        const userId = request.user.id;

        // Verify the notification belongs to the current user
        const existing = await fastify.db.query(
          'SELECT id, recipient_id, status FROM notification_tasks WHERE id = $1',
          [id],
        );

        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Notification not found' });
        }

        if (existing.rows[0].recipient_id !== userId) {
          return reply.status(403).send({ error: 'Forbidden', message: 'You can only mark your own notifications as read' });
        }

        const result = await fastify.db.query(
          `UPDATE notification_tasks
           SET status = 'opened', updated_at = NOW()
           WHERE id = $1
           RETURNING id, recipient_id, type, template_key, status, updated_at`,
          [id],
        );

        fastify.log.info({ notificationId: id, userId }, 'Notification marked as opened');
        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to mark notification as read');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to mark notification as read' });
      }
    },
  );

  // PUT /api/notifications/:id/acknowledge - mark as 'acknowledged'
  fastify.put<{ Params: IdParam }>(
    '/api/notifications/:id/acknowledge',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;
        const userId = request.user.id;

        // Verify the notification belongs to the current user
        const existing = await fastify.db.query(
          'SELECT id, recipient_id, status FROM notification_tasks WHERE id = $1',
          [id],
        );

        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Notification not found' });
        }

        if (existing.rows[0].recipient_id !== userId) {
          return reply.status(403).send({ error: 'Forbidden', message: 'You can only acknowledge your own notifications' });
        }

        const result = await fastify.db.query(
          `UPDATE notification_tasks
           SET status = 'acknowledged', updated_at = NOW()
           WHERE id = $1
           RETURNING id, recipient_id, type, template_key, status, updated_at`,
          [id],
        );

        fastify.log.info({ notificationId: id, userId }, 'Notification acknowledged');
        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to acknowledge notification');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to acknowledge notification' });
      }
    },
  );

  // GET /api/notifications/pending-count - count pending/generated notifications
  fastify.get(
    apiPath(NOTIFICATIONS.PENDING_COUNT),
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = request.user.id;

        const result = await fastify.db.query(
          `SELECT COUNT(*) AS count
           FROM notification_tasks
           WHERE recipient_id = $1 AND status IN ('pending', 'generated')`,
          [userId],
        );

        const count = parseInt(result.rows[0].count, 10);
        return reply.status(200).send({ count });
      } catch (err) {
        fastify.log.error(err, 'Failed to get pending notification count');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get pending notification count' });
      }
    },
  );

  // POST /api/notifications/export/:id - generate export file
  fastify.post<{ Params: IdParam }>(
    '/api/notifications/export/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;
        const userId = request.user.id;

        // Ownership check: only the recipient (or admin) may export
        const existing = await fastify.db.query(
          'SELECT id, recipient_id FROM notification_tasks WHERE id = $1',
          [id]
        );
        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Notification not found' });
        }
        if (existing.rows[0].recipient_id !== userId && request.user.role !== 'admin') {
          return reply.status(403).send({ error: 'Forbidden', message: 'You can only export your own notifications' });
        }

        const filePath = await generateExportFile(fastify.db, id);

        fastify.log.info({ notificationId: id, userId }, 'Notification export file generated');
        return reply.status(200).send({ path: filePath });
      } catch (err: unknown) {
        const error = err as { statusCode?: number; message?: string };
        if (error.statusCode) {
          return reply.status(error.statusCode).send({ error: 'Error', message: error.message });
        }
        fastify.log.error(err, 'Failed to generate notification export');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to generate notification export' });
      }
    },
  );
}
