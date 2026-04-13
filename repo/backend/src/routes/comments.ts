import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface IdParam {
  id: string;
}

interface ListCommentsQuery {
  entityType: string;
  entityId: string;
}

interface CreateCommentBody {
  entity_type: string;
  entity_id: string;
  body: string;
}

const listCommentsQuerySchema = {
  querystring: {
    type: 'object',
    required: ['entityType', 'entityId'],
    properties: {
      entityType: { type: 'string', minLength: 1 },
      entityId: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
};

const createCommentSchema = {
  body: {
    type: 'object',
    required: ['entity_type', 'entity_id', 'body'],
    properties: {
      entity_type: { type: 'string', minLength: 1, maxLength: 100 },
      entity_id: { type: 'string', minLength: 1 },
      body: { type: 'string', minLength: 1, maxLength: 5000 },
    },
    additionalProperties: false,
  },
};

export default async function commentRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/comments?entityType=X&entityId=Y - list comments for an entity
  fastify.get(
    '/api/comments',
    {
      preHandler: [fastify.authenticate],
      schema: listCommentsQuerySchema,
    },
    async (
      request: FastifyRequest<{ Querystring: ListCommentsQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const { entityType, entityId } = request.query;

        const result = await fastify.db.query(
          `SELECT c.id, c.entity_type, c.entity_id, c.author_id, c.body, c.created_at,
                  u.username AS author_username
           FROM comments c
           LEFT JOIN users u ON u.id = c.author_id
           WHERE c.entity_type = $1 AND c.entity_id = $2
           ORDER BY c.created_at ASC`,
          [entityType, entityId],
        );

        return reply.status(200).send({ data: result.rows });
      } catch (err) {
        fastify.log.error(err, 'Failed to list comments');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list comments' });
      }
    },
  );

  // POST /api/comments - create comment
  fastify.post(
    '/api/comments',
    {
      preHandler: [fastify.authenticate],
      schema: createCommentSchema,
    },
    async (
      request: FastifyRequest<{ Body: CreateCommentBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const { entity_type, entity_id, body } = request.body;
        const authorId = request.user.id;

        const result = await fastify.db.query(
          `INSERT INTO comments (entity_type, entity_id, author_id, body)
           VALUES ($1, $2, $3, $4)
           RETURNING id, entity_type, entity_id, author_id, body, created_at`,
          [entity_type, entity_id, authorId, body],
        );

        fastify.log.info({ commentId: result.rows[0].id, entityType: entity_type, entityId: entity_id }, 'Comment created');
        return reply.status(201).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to create comment');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to create comment' });
      }
    },
  );

  // DELETE /api/comments/:id - delete own comment (or admin)
  fastify.delete(
    '/api/comments/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (
      request: FastifyRequest<{ Params: IdParam }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;

        const existing = await fastify.db.query(
          'SELECT id, author_id FROM comments WHERE id = $1',
          [id],
        );

        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Comment not found' });
        }

        const comment = existing.rows[0];

        // Only the author or an admin can delete the comment
        if (comment.author_id !== request.user.id && request.user.role !== 'admin') {
          return reply.status(403).send({ error: 'Forbidden', message: 'You can only delete your own comments' });
        }

        await fastify.db.query('DELETE FROM comments WHERE id = $1', [id]);

        fastify.log.info({ commentId: id, deletedBy: request.user.id }, 'Comment deleted');
        return reply.status(200).send({ message: 'Comment deleted successfully' });
      } catch (err) {
        fastify.log.error(err, 'Failed to delete comment');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to delete comment' });
      }
    },
  );
}
