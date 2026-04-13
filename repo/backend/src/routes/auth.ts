import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as bcrypt from 'bcryptjs';

interface LoginBody {
  username: string;
  password: string;
}

interface VerifyPasswordBody {
  password: string;
}

const loginSchema = {
  body: {
    type: 'object',
    required: ['username', 'password'],
    properties: {
      username: { type: 'string', minLength: 1 },
      password: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
};

const verifyPasswordSchema = {
  body: {
    type: 'object',
    required: ['password'],
    properties: {
      password: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
};

export default async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/auth/login
  fastify.post<{ Body: LoginBody }>(
    '/api/auth/login',
    { schema: loginSchema },
    async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      const { username, password } = request.body;

      try {
        const result = await fastify.db.query(
          'SELECT id, username, password_hash, role, force_password_change FROM users WHERE username = $1',
          [username]
        );

        if (result.rows.length === 0) {
          fastify.log.warn({ username }, 'Login attempt for non-existent user');
          return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid username or password' });
        }

        const user = result.rows[0];
        const passwordValid = await bcrypt.compare(password, user.password_hash);

        if (!passwordValid) {
          fastify.log.warn({ username }, 'Login attempt with invalid password');
          return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid username or password' });
        }

        const tokenPayload = { id: user.id, username: user.username, role: user.role };
        const token = fastify.jwt.sign(tokenPayload);

        fastify.log.info({ userId: user.id, username: user.username }, 'User logged in successfully');

        const response: Record<string, unknown> = { token, user: tokenPayload };
        if (user.force_password_change) {
          response.force_password_change = true;
        }

        return reply.send(response);
      } catch (err) {
        fastify.log.error({ err, username }, 'Login failed due to server error');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/auth/logout
  fastify.post(
    '/api/auth/logout',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      fastify.log.info({ userId: request.user.id }, 'User logged out');
      return reply.send({ message: 'Logged out successfully' });
    }
  );

  // GET /api/auth/me
  fastify.get(
    '/api/auth/me',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await fastify.db.query(
          `SELECT id, username, role, locale, force_password_change, created_at, updated_at
           FROM users WHERE id = $1`,
          [request.user.id]
        );

        if (result.rows.length === 0) {
          fastify.log.warn({ userId: request.user.id }, 'Authenticated user not found in database');
          return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
        }

        return reply.send(result.rows[0]);
      } catch (err) {
        fastify.log.error({ err, userId: request.user.id }, 'Failed to fetch user profile');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/auth/verify-password
  fastify.post<{ Body: VerifyPasswordBody }>(
    '/api/auth/verify-password',
    { schema: verifyPasswordSchema, preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Body: VerifyPasswordBody }>, reply: FastifyReply) => {
      const { password } = request.body;

      try {
        const result = await fastify.db.query(
          'SELECT password_hash FROM users WHERE id = $1',
          [request.user.id]
        );

        if (result.rows.length === 0) {
          fastify.log.warn({ userId: request.user.id }, 'Verify-password: user not found');
          return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
        }

        const valid = await bcrypt.compare(password, result.rows[0].password_hash);

        fastify.log.info({ userId: request.user.id, verified: valid }, 'Password verification attempted');

        return reply.send({ verified: valid });
      } catch (err) {
        fastify.log.error({ err, userId: request.user.id }, 'Password verification failed due to server error');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );
}
