import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import formbody from '@fastify/formbody';
import cors from '@fastify/cors';
import { config } from './config';

// Plugins
import databasePlugin from './plugins/database';
import authPlugin from './plugins/auth';

// Routes
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import projectRoutes from './routes/projects';
import postingRoutes from './routes/postings';
import candidateRoutes from './routes/candidates';
import resumeRoutes from './routes/resumes';
import attachmentRoutes from './routes/attachments';
import violationRoutes from './routes/violations';
import serviceRoutes from './routes/services';
import pricingRoutes from './routes/pricing';
import capacityRoutes from './routes/capacity';
import creditChangeRoutes from './routes/credit-changes';
import approvalTemplateRoutes from './routes/approval-templates';
import approvalRoutes from './routes/approvals';
import notificationTemplateRoutes from './routes/notification-templates';
import notificationRoutes from './routes/notifications';
import tagRoutes from './routes/tags';
import commentRoutes from './routes/comments';
import geoRoutes from './routes/geo';
import mediaRoutes from './routes/media';
import searchRoutes from './routes/search';
import checkpointRoutes from './routes/checkpoint';
import auditRoutes from './routes/audit';
import systemRoutes from './routes/system';

async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: config.logging.level,
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // Register core plugins
  await fastify.register(cors, { origin: true });
  await fastify.register(formbody);
  await fastify.register(multipart, {
    limits: { fileSize: config.upload.maxFileSize },
  });

  // Database and auth
  await fastify.register(databasePlugin);
  await fastify.register(authPlugin);

  // Register all routes
  await fastify.register(authRoutes);
  await fastify.register(userRoutes);
  await fastify.register(projectRoutes);
  await fastify.register(postingRoutes);
  await fastify.register(candidateRoutes);
  await fastify.register(resumeRoutes);
  await fastify.register(attachmentRoutes);
  await fastify.register(violationRoutes);
  await fastify.register(serviceRoutes);
  await fastify.register(pricingRoutes);
  await fastify.register(capacityRoutes);
  await fastify.register(creditChangeRoutes);
  await fastify.register(approvalTemplateRoutes);
  await fastify.register(approvalRoutes);
  await fastify.register(notificationTemplateRoutes);
  await fastify.register(notificationRoutes);
  await fastify.register(tagRoutes);
  await fastify.register(commentRoutes);
  await fastify.register(geoRoutes);
  await fastify.register(mediaRoutes);
  await fastify.register(searchRoutes);
  await fastify.register(checkpointRoutes);
  await fastify.register(auditRoutes);
  await fastify.register(systemRoutes);

  // Global error handler
  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error({
      err: error,
      method: request.method,
      url: request.url,
      requestId: request.id,
    }, 'Request error');

    const statusCode = error.statusCode || 500;
    reply.status(statusCode).send({
      error: error.name || 'InternalServerError',
      message: statusCode === 500 ? 'Internal server error' : error.message,
      statusCode,
    });
  });

  // Not found handler
  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: 'NotFound',
      message: `Route ${request.method} ${request.url} not found`,
      statusCode: 404,
    });
  });

  return fastify;
}

async function start() {
  const fastify = await buildApp();

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      fastify.log.info(`Received ${signal}, shutting down gracefully`);
      await fastify.close();
      process.exit(0);
    });
  }

  try {
    await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`TalentOps server running on http://${config.host}:${config.port}`);

    // Start notification retry processor (every 30 seconds)
    const { processRetryQueue } = await import('./services/notification.service');
    const retryInterval = setInterval(async () => {
      try {
        const count = await processRetryQueue(fastify.db);
        if (count > 0) {
          fastify.log.info({ retried: count }, 'Notification retry cycle completed');
        }
      } catch (err) {
        fastify.log.error({ err }, 'Notification retry cycle failed');
      }
    }, 30_000);

    // Clear interval on shutdown (use process signal since hooks can't be added post-listen)
    process.on('beforeExit', () => { clearInterval(retryInterval); });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();

export { buildApp };
