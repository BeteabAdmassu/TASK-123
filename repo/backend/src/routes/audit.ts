import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface AuditQuery {
  entity_type?: string;
  entity_id?: string;
  actor_id?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

const auditQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      entity_type: { type: 'string', minLength: 1 },
      entity_id: { type: 'string', minLength: 1 },
      actor_id: { type: 'string', minLength: 1 },
      from: { type: 'string', format: 'date-time' },
      to: { type: 'string', format: 'date-time' },
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
    additionalProperties: false,
  },
};

export default async function auditRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/audit - query audit trail (admin only)
  fastify.get(
    '/api/audit',
    {
      preHandler: [fastify.authorize('admin')],
      schema: auditQuerySchema,
    },
    async (
      request: FastifyRequest<{ Querystring: AuditQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const page = request.query.page || 1;
        const pageSize = request.query.pageSize || 25;
        const offset = (page - 1) * pageSize;

        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (request.query.entity_type) {
          conditions.push(`at.entity_type = $${paramIndex}`);
          params.push(request.query.entity_type);
          paramIndex++;
        }

        if (request.query.entity_id) {
          conditions.push(`at.entity_id = $${paramIndex}`);
          params.push(request.query.entity_id);
          paramIndex++;
        }

        if (request.query.actor_id) {
          conditions.push(`at.actor_id = $${paramIndex}`);
          params.push(request.query.actor_id);
          paramIndex++;
        }

        if (request.query.from) {
          conditions.push(`at.created_at >= $${paramIndex}`);
          params.push(request.query.from);
          paramIndex++;
        }

        if (request.query.to) {
          conditions.push(`at.created_at <= $${paramIndex}`);
          params.push(request.query.to);
          paramIndex++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await fastify.db.query(
          `SELECT COUNT(*) AS total FROM audit_trail at ${whereClause}`,
          params,
        );
        const total = parseInt(countResult.rows[0].total, 10);

        const dataParams = [...params, pageSize, offset];
        const dataResult = await fastify.db.query(
          `SELECT at.id, at.entity_type, at.entity_id, at.action, at.actor_id,
                  at.before_state, at.after_state, at.metadata, at.created_at,
                  u.username AS actor_username
           FROM audit_trail at
           LEFT JOIN users u ON u.id = at.actor_id
           ${whereClause}
           ORDER BY at.created_at DESC
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
        fastify.log.error(err, 'Failed to query audit trail');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to query audit trail' });
      }
    },
  );
}
