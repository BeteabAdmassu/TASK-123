import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PostingStatus } from '../models';
import { checkProjectAccess, checkPostingAccess } from '../services/project-access';

const createPostingSchema = {
  body: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 5000 },
      requirements: { type: 'object' },
      field_rules: { type: 'object' },
      status: { type: 'string', enum: ['draft', 'open', 'closed'] },
    },
    additionalProperties: false,
  },
};

const updatePostingSchema = {
  body: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 5000 },
      requirements: { type: 'object' },
      field_rules: { type: 'object' },
      status: { type: 'string', enum: ['draft', 'open', 'closed'] },
    },
    additionalProperties: false,
    minProperties: 1,
  },
};

const listPostingsQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
    additionalProperties: false,
  },
};

interface CreatePostingBody {
  title: string;
  description?: string;
  requirements?: Record<string, unknown>;
  field_rules?: Record<string, unknown>;
  status?: PostingStatus;
}

interface UpdatePostingBody {
  title?: string;
  description?: string;
  requirements?: Record<string, unknown>;
  field_rules?: Record<string, unknown>;
  status?: PostingStatus;
}

interface ListPostingsQuery {
  page?: number;
  pageSize?: number;
}

interface ProjectIdParam {
  projectId: string;
}

interface IdParam {
  id: string;
}

export default async function postingRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/projects/:projectId/postings - list postings for a project (paginated)
  fastify.get(
    '/api/projects/:projectId/postings',
    {
      preHandler: [fastify.authenticate],
      schema: listPostingsQuerySchema,
    },
    async (
      request: FastifyRequest<{ Params: ProjectIdParam; Querystring: ListPostingsQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const { projectId } = request.params;
        const page = request.query.page || 1;
        const pageSize = request.query.pageSize || 25;
        const offset = (page - 1) * pageSize;

        // Verify the project exists and is not archived
        const projectResult = await fastify.db.query(
          'SELECT id FROM recruiting_projects WHERE id = $1 AND archived_at IS NULL',
          [projectId],
        );

        if (projectResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Project not found' });
        }

        // Object-level auth on parent project
        const access = await checkProjectAccess(fastify.db, projectId, request.user.id, request.user.role);
        if (!access.allowed) {
          return reply.status(access.status!).send({ error: 'Forbidden', message: access.message });
        }

        const countResult = await fastify.db.query(
          'SELECT COUNT(*) AS total FROM job_postings WHERE project_id = $1 AND archived_at IS NULL',
          [projectId],
        );
        const total = parseInt(countResult.rows[0].total, 10);

        const dataResult = await fastify.db.query(
          `SELECT id, project_id, title, description, requirements, field_rules, status, created_at, updated_at
           FROM job_postings
           WHERE project_id = $1 AND archived_at IS NULL
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [projectId, pageSize, offset],
        );

        return reply.status(200).send({
          data: dataResult.rows,
          total,
          page,
          pageSize,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to list postings');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list postings' });
      }
    },
  );

  // POST /api/projects/:projectId/postings - create posting
  fastify.post(
    '/api/projects/:projectId/postings',
    {
      preHandler: [fastify.authorize('admin', 'recruiter')],
      schema: createPostingSchema,
    },
    async (
      request: FastifyRequest<{ Params: ProjectIdParam; Body: CreatePostingBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const { projectId } = request.params;
        const { title, description, requirements, field_rules, status } = request.body;
        const postingStatus = status || 'draft';

        // Validate project exists and is not archived
        const projectResult = await fastify.db.query(
          'SELECT id FROM recruiting_projects WHERE id = $1 AND archived_at IS NULL',
          [projectId],
        );

        if (projectResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Project not found' });
        }

        const result = await fastify.db.query(
          `INSERT INTO job_postings (project_id, title, description, requirements, field_rules, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, project_id, title, description, requirements, field_rules, status, archived_at, created_at, updated_at`,
          [
            projectId,
            title,
            description || null,
            requirements ? JSON.stringify(requirements) : null,
            field_rules ? JSON.stringify(field_rules) : null,
            postingStatus,
          ],
        );

        fastify.log.info({ postingId: result.rows[0].id, projectId }, 'Posting created');
        return reply.status(201).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to create posting');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to create posting' });
      }
    },
  );

  // GET /api/postings/:id - get posting detail (object-level auth)
  fastify.get(
    '/api/postings/:id',
    {
      preHandler: [fastify.authenticate],
    },
    async (
      request: FastifyRequest<{ Params: IdParam }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;

        const result = await fastify.db.query(
          `SELECT id, project_id, title, description, requirements, field_rules, status, created_at, updated_at
           FROM job_postings
           WHERE id = $1 AND archived_at IS NULL`,
          [id],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Posting not found' });
        }

        const access = await checkPostingAccess(fastify.db, id, request.user.id, request.user.role);
        if (!access.allowed) {
          return reply.status(access.status!).send({ error: 'Forbidden', message: access.message });
        }

        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to get posting');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get posting' });
      }
    },
  );

  // PUT /api/postings/:id - update posting
  fastify.put(
    '/api/postings/:id',
    {
      preHandler: [fastify.authorize('admin', 'recruiter')],
      schema: updatePostingSchema,
    },
    async (
      request: FastifyRequest<{ Params: IdParam; Body: UpdatePostingBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        const { title, description, requirements, field_rules, status } = request.body;

        // Check posting exists and is not archived
        const existing = await fastify.db.query(
          'SELECT id FROM job_postings WHERE id = $1 AND archived_at IS NULL',
          [id],
        );

        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Posting not found' });
        }

        // Object-level auth via parent project
        const access = await checkPostingAccess(fastify.db, id, request.user.id, request.user.role);
        if (!access.allowed) {
          return reply.status(access.status!).send({ error: 'Forbidden', message: access.message });
        }

        const setClauses: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (title !== undefined) {
          setClauses.push(`title = $${paramIndex}`);
          params.push(title);
          paramIndex++;
        }
        if (description !== undefined) {
          setClauses.push(`description = $${paramIndex}`);
          params.push(description);
          paramIndex++;
        }
        if (requirements !== undefined) {
          setClauses.push(`requirements = $${paramIndex}`);
          params.push(JSON.stringify(requirements));
          paramIndex++;
        }
        if (field_rules !== undefined) {
          setClauses.push(`field_rules = $${paramIndex}`);
          params.push(JSON.stringify(field_rules));
          paramIndex++;
        }
        if (status !== undefined) {
          setClauses.push(`status = $${paramIndex}`);
          params.push(status);
          paramIndex++;
        }

        setClauses.push(`updated_at = NOW()`);

        params.push(id);
        const result = await fastify.db.query(
          `UPDATE job_postings
           SET ${setClauses.join(', ')}
           WHERE id = $${paramIndex} AND archived_at IS NULL
           RETURNING id, project_id, title, description, requirements, field_rules, status, created_at, updated_at`,
          params,
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Posting not found' });
        }

        fastify.log.info({ postingId: id }, 'Posting updated');
        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to update posting');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update posting' });
      }
    },
  );

  // DELETE /api/postings/:id - soft delete (set archived_at = NOW())
  fastify.delete(
    '/api/postings/:id',
    {
      preHandler: [fastify.authorize('admin', 'recruiter')],
    },
    async (
      request: FastifyRequest<{ Params: IdParam }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;

        const result = await fastify.db.query(
          `UPDATE job_postings
           SET archived_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND archived_at IS NULL
           RETURNING id`,
          [id],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Posting not found' });
        }

        fastify.log.info({ postingId: id }, 'Posting archived');
        return reply.status(200).send({ message: 'Posting archived successfully' });
      } catch (err) {
        fastify.log.error(err, 'Failed to archive posting');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to archive posting' });
      }
    },
  );
}
