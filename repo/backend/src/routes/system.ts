import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export default async function systemRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/health - health check (no auth)
  fastify.get(
    '/api/health',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Verify database connectivity
        await fastify.db.query('SELECT 1');

        return reply.status(200).send({
          status: 'ok',
          timestamp: new Date().toISOString(),
          version: '1.0.0',
        });
      } catch (err) {
        fastify.log.error(err, 'Health check failed');
        return reply.status(503).send({
          status: 'error',
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          message: 'Database connection failed',
        });
      }
    },
  );

  // GET /api/system/update-info - check for update package (mock)
  fastify.get(
    '/api/system/update-info',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return reply.status(200).send({
          current_version: '1.0.0',
          latest_version: '1.1.0',
          update_available: true,
          release_notes: 'Bug fixes and performance improvements',
          release_date: '2026-04-10',
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to check for updates');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to check for updates' });
      }
    },
  );

  // POST /api/system/apply-update - apply update (mock)
  fastify.post(
    '/api/system/apply-update',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        fastify.log.info({ userId: request.user.id }, 'System update applied (mock)');
        return reply.status(200).send({
          success: true,
          message: 'Update applied successfully',
          new_version: '1.1.0',
          applied_at: new Date().toISOString(),
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to apply update');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to apply update' });
      }
    },
  );

  // POST /api/system/rollback - rollback update (mock)
  fastify.post(
    '/api/system/rollback',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        fastify.log.info({ userId: request.user.id }, 'System rollback performed (mock)');
        return reply.status(200).send({
          success: true,
          message: 'Rollback completed successfully',
          restored_version: '1.0.0',
          rolled_back_at: new Date().toISOString(),
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to rollback');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to rollback' });
      }
    },
  );
}
