import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Pool, PoolClient } from 'pg';
import { config } from '../config';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
  }
}

async function databasePlugin(fastify: FastifyInstance): Promise<void> {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Test connection
  try {
    const client: PoolClient = await pool.connect();
    client.release();
    fastify.log.info('Database connected successfully');
  } catch (err) {
    fastify.log.error('Database connection failed:', err);
    throw err;
  }

  fastify.decorate('db', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
    fastify.log.info('Database pool closed');
  });
}

export default fp(databasePlugin, { name: 'database' });
