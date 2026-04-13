import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface SaveCheckpointBody {
  checkpoint_data: Record<string, unknown>;
}

const saveCheckpointSchema = {
  body: {
    type: 'object',
    required: ['checkpoint_data'],
    properties: {
      checkpoint_data: { type: 'object' },
    },
    additionalProperties: false,
  },
};

export default async function checkpointRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/checkpoint - save checkpoint (upsert per user: delete old, insert new)
  fastify.post(
    '/api/checkpoint',
    {
      preHandler: [fastify.authenticate],
      schema: saveCheckpointSchema,
    },
    async (
      request: FastifyRequest<{ Body: SaveCheckpointBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const userId = request.user.id;
        const { checkpoint_data } = request.body;

        // Delete existing checkpoints for this user
        await fastify.db.query(
          'DELETE FROM app_checkpoints WHERE user_id = $1',
          [userId],
        );

        // Insert new checkpoint
        const result = await fastify.db.query(
          `INSERT INTO app_checkpoints (user_id, checkpoint_data)
           VALUES ($1, $2)
           RETURNING id, user_id, checkpoint_data, created_at`,
          [userId, JSON.stringify(checkpoint_data)],
        );

        fastify.log.info({ userId, checkpointId: result.rows[0].id }, 'Checkpoint saved');
        return reply.status(201).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to save checkpoint');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to save checkpoint' });
      }
    },
  );

  // GET /api/checkpoint/latest - get latest checkpoint for current user
  fastify.get(
    '/api/checkpoint/latest',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = request.user.id;

        const result = await fastify.db.query(
          `SELECT id, user_id, checkpoint_data, created_at
           FROM app_checkpoints
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [userId],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'No checkpoint found' });
        }

        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to get checkpoint');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get checkpoint' });
      }
    },
  );
}
