import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as bcrypt from 'bcryptjs';

interface CreateUserBody {
  username: string;
  password: string;
  role: 'admin' | 'recruiter' | 'reviewer' | 'approver';
  locale?: string;
}

interface UpdateUserBody {
  role?: 'admin' | 'recruiter' | 'reviewer' | 'approver';
  locale?: string;
  force_password_change?: boolean;
}

interface UserIdParams {
  id: string;
}

interface ListUsersQuery {
  page?: number;
  pageSize?: number;
}

const createUserSchema = {
  body: {
    type: 'object',
    required: ['username', 'password', 'role'],
    properties: {
      username: { type: 'string', minLength: 1, maxLength: 255 },
      password: { type: 'string', minLength: 6 },
      role: { type: 'string', enum: ['admin', 'recruiter', 'reviewer', 'approver'] },
      locale: { type: 'string', maxLength: 10 },
    },
    additionalProperties: false,
  },
};

const updateUserSchema = {
  body: {
    type: 'object',
    properties: {
      role: { type: 'string', enum: ['admin', 'recruiter', 'reviewer', 'approver'] },
      locale: { type: 'string', maxLength: 10 },
      force_password_change: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
    },
  },
};

const deleteUserSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
    },
  },
};

const listUsersSchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
  },
};

const SALT_ROUNDS = 10;

export default async function userRoutes(fastify: FastifyInstance): Promise<void> {
  // All routes require admin role
  fastify.addHook('preHandler', fastify.authorize('admin'));

  // GET /api/users - List all users (paginated)
  fastify.get<{ Querystring: ListUsersQuery }>(
    '/api/users',
    { schema: listUsersSchema },
    async (request: FastifyRequest<{ Querystring: ListUsersQuery }>, reply: FastifyReply) => {
      const page = request.query.page ?? 1;
      const pageSize = request.query.pageSize ?? 25;
      const offset = (page - 1) * pageSize;

      try {
        const countResult = await fastify.db.query('SELECT COUNT(*) FROM users');
        const total = parseInt(countResult.rows[0].count, 10);

        const result = await fastify.db.query(
          `SELECT id, username, role, locale, force_password_change, created_at, updated_at
           FROM users
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
          [pageSize, offset]
        );

        fastify.log.info({ page, pageSize, total }, 'Listed users');

        return reply.send({
          data: result.rows,
          total,
          page,
          pageSize,
        });
      } catch (err) {
        fastify.log.error({ err }, 'Failed to list users');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/users - Create a new user
  fastify.post<{ Body: CreateUserBody }>(
    '/api/users',
    { schema: createUserSchema },
    async (request: FastifyRequest<{ Body: CreateUserBody }>, reply: FastifyReply) => {
      const { username, password, role, locale } = request.body;

      try {
        // Check for duplicate username
        const existing = await fastify.db.query(
          'SELECT id FROM users WHERE username = $1',
          [username]
        );

        if (existing.rows.length > 0) {
          fastify.log.warn({ username }, 'Attempted to create user with duplicate username');
          return reply.status(409).send({ error: 'Conflict', message: 'Username already exists' });
        }

        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        const result = await fastify.db.query(
          `INSERT INTO users (username, password_hash, role, locale)
           VALUES ($1, $2, $3, $4)
           RETURNING id, username, role, locale, force_password_change, created_at, updated_at`,
          [username, passwordHash, role, locale || 'en']
        );

        fastify.log.info({ userId: result.rows[0].id, username, role }, 'User created');

        return reply.status(201).send(result.rows[0]);
      } catch (err) {
        fastify.log.error({ err, username }, 'Failed to create user');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // PUT /api/users/:id - Update a user
  fastify.put<{ Params: UserIdParams; Body: UpdateUserBody }>(
    '/api/users/:id',
    { schema: updateUserSchema },
    async (request: FastifyRequest<{ Params: UserIdParams; Body: UpdateUserBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { role, locale, force_password_change } = request.body;

      try {
        // Check user exists
        const existing = await fastify.db.query('SELECT id FROM users WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
          fastify.log.warn({ userId: id }, 'Attempted to update non-existent user');
          return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
        }

        // Build dynamic update query
        const setClauses: string[] = [];
        const values: unknown[] = [];
        let paramIndex = 1;

        if (role !== undefined) {
          setClauses.push(`role = $${paramIndex++}`);
          values.push(role);
        }
        if (locale !== undefined) {
          setClauses.push(`locale = $${paramIndex++}`);
          values.push(locale);
        }
        if (force_password_change !== undefined) {
          setClauses.push(`force_password_change = $${paramIndex++}`);
          values.push(force_password_change);
        }

        if (setClauses.length === 0) {
          return reply.status(400).send({ error: 'Bad Request', message: 'No fields to update' });
        }

        setClauses.push(`updated_at = NOW()`);
        values.push(id);

        const result = await fastify.db.query(
          `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex}
           RETURNING id, username, role, locale, force_password_change, created_at, updated_at`,
          values
        );

        fastify.log.info({ userId: id, updatedFields: Object.keys(request.body) }, 'User updated');

        return reply.send(result.rows[0]);
      } catch (err) {
        fastify.log.error({ err, userId: id }, 'Failed to update user');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // DELETE /api/users/:id - Soft deactivate a user
  fastify.delete<{ Params: UserIdParams }>(
    '/api/users/:id',
    { schema: deleteUserSchema },
    async (request: FastifyRequest<{ Params: UserIdParams }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        // Prevent self-deletion
        if (id === request.user.id) {
          return reply.status(400).send({ error: 'Bad Request', message: 'Cannot deactivate your own account' });
        }

        const existing = await fastify.db.query('SELECT id, username FROM users WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
          fastify.log.warn({ userId: id }, 'Attempted to deactivate non-existent user');
          return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
        }

        // Soft deactivate by setting role to indicate deactivation and forcing password change
        await fastify.db.query(
          `UPDATE users SET force_password_change = true, updated_at = NOW() WHERE id = $1`,
          [id]
        );

        fastify.log.info({ userId: id, username: existing.rows[0].username }, 'User deactivated');

        return reply.send({ message: 'User deactivated successfully' });
      } catch (err) {
        fastify.log.error({ err, userId: id }, 'Failed to deactivate user');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );
}
