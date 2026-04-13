import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface IdParam {
  id: string;
}

interface CreateTagBody {
  name: string;
  color?: string;
}

interface UpdateTagBody {
  name?: string;
  color?: string;
}

const createTagSchema = {
  body: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      color: { type: 'string', maxLength: 7, pattern: '^#[0-9a-fA-F]{6}$' },
    },
    additionalProperties: false,
  },
};

const updateTagSchema = {
  body: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      color: { type: 'string', maxLength: 7, pattern: '^#[0-9a-fA-F]{6}$' },
    },
    additionalProperties: false,
    minProperties: 1,
  },
};

export default async function tagRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/tags - list all tags
  fastify.get(
    '/api/tags',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await fastify.db.query(
          'SELECT id, name, color FROM tags ORDER BY name ASC',
        );
        return reply.status(200).send({ data: result.rows });
      } catch (err) {
        fastify.log.error(err, 'Failed to list tags');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list tags' });
      }
    },
  );

  // POST /api/tags - create tag
  fastify.post(
    '/api/tags',
    {
      preHandler: [fastify.authorize('recruiter', 'admin')],
      schema: createTagSchema,
    },
    async (
      request: FastifyRequest<{ Body: CreateTagBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const { name, color } = request.body;

        // Check for duplicate name
        const existing = await fastify.db.query(
          'SELECT id FROM tags WHERE LOWER(name) = LOWER($1)',
          [name],
        );

        if (existing.rows.length > 0) {
          return reply.status(409).send({ error: 'Conflict', message: 'A tag with this name already exists' });
        }

        const result = await fastify.db.query(
          `INSERT INTO tags (name, color)
           VALUES ($1, $2)
           RETURNING id, name, color`,
          [name, color || null],
        );

        fastify.log.info({ tagId: result.rows[0].id, name }, 'Tag created');
        return reply.status(201).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to create tag');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to create tag' });
      }
    },
  );

  // PUT /api/tags/:id - update tag
  fastify.put(
    '/api/tags/:id',
    {
      preHandler: [fastify.authorize('recruiter', 'admin')],
      schema: updateTagSchema,
    },
    async (
      request: FastifyRequest<{ Params: IdParam; Body: UpdateTagBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        const { name, color } = request.body;

        const existing = await fastify.db.query(
          'SELECT id FROM tags WHERE id = $1',
          [id],
        );

        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Tag not found' });
        }

        // Check for duplicate name if name is being updated
        if (name !== undefined) {
          const duplicate = await fastify.db.query(
            'SELECT id FROM tags WHERE LOWER(name) = LOWER($1) AND id != $2',
            [name, id],
          );

          if (duplicate.rows.length > 0) {
            return reply.status(409).send({ error: 'Conflict', message: 'A tag with this name already exists' });
          }
        }

        const setClauses: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (name !== undefined) {
          setClauses.push(`name = $${paramIndex}`);
          params.push(name);
          paramIndex++;
        }
        if (color !== undefined) {
          setClauses.push(`color = $${paramIndex}`);
          params.push(color);
          paramIndex++;
        }

        params.push(id);
        const result = await fastify.db.query(
          `UPDATE tags
           SET ${setClauses.join(', ')}
           WHERE id = $${paramIndex}
           RETURNING id, name, color`,
          params,
        );

        fastify.log.info({ tagId: id }, 'Tag updated');
        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to update tag');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update tag' });
      }
    },
  );

  // DELETE /api/tags/:id - hard delete tag
  fastify.delete(
    '/api/tags/:id',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (
      request: FastifyRequest<{ Params: IdParam }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;

        const result = await fastify.db.query(
          'DELETE FROM tags WHERE id = $1 RETURNING id',
          [id],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Tag not found' });
        }

        fastify.log.info({ tagId: id }, 'Tag deleted');
        return reply.status(200).send({ message: 'Tag deleted successfully' });
      } catch (err) {
        fastify.log.error(err, 'Failed to delete tag');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to delete tag' });
      }
    },
  );
}
