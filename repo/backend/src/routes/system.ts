import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SYSTEM } from '../../../shared/api-contracts';
import { apiPath } from '../../../shared/contract-utils';

const HEALTH_PATH = apiPath(SYSTEM.HEALTH);

export default async function systemRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/health - health check (no auth)
  fastify.get(
    HEALTH_PATH,
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

  // ---------------------------------------------------------------------------
  // Desktop-mode update stubs
  //
  // These endpoints are mock/stub implementations for the web-served mode.
  // In production desktop (Electron) builds, the actual update logic is handled
  // by electron/updater.ts which manages native auto-update via electron-updater.
  // These stubs return realistic response shapes so the frontend can develop
  // against a stable API contract without requiring the Electron runtime.
  // ---------------------------------------------------------------------------

  // GET /api/system/update-info - check for update package (desktop-mode stub)
  // In production, delegates to electron/updater.ts checkForUpdates()
  fastify.get(
    '/api/system/update-info',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return reply.status(200).send({
          status: 'success',
          current_version: '1.0.0',
          latest_version: '1.1.0',
          update_available: true,
          release_notes: 'Bug fixes and performance improvements',
          release_date: '2026-04-10',
          download_size_bytes: 52428800,
          channel: 'stable',
          checked_at: new Date().toISOString(),
          is_stub: true,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to check for updates');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to check for updates' });
      }
    },
  );

  // POST /api/system/apply-update - apply update (desktop-mode stub)
  // In production, delegates to electron/updater.ts applyUpdate() which
  // downloads the update package and triggers a restart via autoUpdater.quitAndInstall()
  fastify.post(
    '/api/system/apply-update',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        fastify.log.info({ userId: request.user.id }, 'System update applied (desktop-mode stub)');
        return reply.status(200).send({
          status: 'success',
          previous_version: '1.0.0',
          new_version: '1.1.0',
          applied_at: new Date().toISOString(),
          restart_required: true,
          is_stub: true,
          message: 'Update applied successfully. In desktop mode, the application would restart automatically.',
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to apply update');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to apply update' });
      }
    },
  );

  // POST /api/system/rollback - rollback update (desktop-mode stub)
  // In production, delegates to electron/updater.ts rollback() which restores
  // the previous app.asar from the backup directory and triggers a restart
  fastify.post(
    '/api/system/rollback',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        fastify.log.info({ userId: request.user.id }, 'System rollback performed (desktop-mode stub)');
        return reply.status(200).send({
          status: 'success',
          rolled_back_from: '1.1.0',
          restored_version: '1.0.0',
          rolled_back_at: new Date().toISOString(),
          restart_required: true,
          is_stub: true,
          message: 'Rollback completed successfully. In desktop mode, the application would restart to the previous version.',
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to rollback');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to rollback' });
      }
    },
  );
}
