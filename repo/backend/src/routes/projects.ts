import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ProjectStatus } from '../models';
import { checkProjectAccess } from '../services/project-access';

const createProjectSchema = {
  body: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 2000 },
      status: { type: 'string', enum: ['draft', 'active', 'completed', 'archived'] },
    },
    additionalProperties: false,
  },
};

const updateProjectSchema = {
  body: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 2000 },
      status: { type: 'string', enum: ['draft', 'active', 'completed', 'archived'] },
    },
    additionalProperties: false,
    minProperties: 1,
  },
};

const listProjectsQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      status: { type: 'string', enum: ['draft', 'active', 'completed', 'archived'] },
    },
    additionalProperties: false,
  },
};

interface CreateProjectBody {
  title: string;
  description?: string;
  status?: ProjectStatus;
}

interface UpdateProjectBody {
  title?: string;
  description?: string;
  status?: ProjectStatus;
}

interface ListProjectsQuery {
  page?: number;
  pageSize?: number;
  status?: ProjectStatus;
}

interface IdParam {
  id: string;
}

export default async function projectRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/projects - list projects (paginated), filter by status, exclude archived
  fastify.get(
    '/api/projects',
    {
      preHandler: [fastify.authenticate],
      schema: listProjectsQuerySchema,
    },
    async (
      request: FastifyRequest<{ Querystring: ListProjectsQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const page = request.query.page || 1;
        const pageSize = request.query.pageSize || 25;
        const offset = (page - 1) * pageSize;
        const status = request.query.status;

        const conditions: string[] = ['archived_at IS NULL'];
        const params: unknown[] = [];
        let paramIndex = 1;

        // Object-level: non-admin/reviewer users see only their own projects
        const userRole = request.user.role;
        if (userRole !== 'admin' && userRole !== 'reviewer') {
          conditions.push(`created_by = $${paramIndex}`);
          params.push(request.user.id);
          paramIndex++;
        }

        if (status) {
          conditions.push(`status = $${paramIndex}`);
          params.push(status);
          paramIndex++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await fastify.db.query(
          `SELECT COUNT(*) AS total FROM recruiting_projects ${whereClause}`,
          params,
        );
        const total = parseInt(countResult.rows[0].total, 10);

        const dataParams = [...params, pageSize, offset];
        const dataResult = await fastify.db.query(
          `SELECT id, title, description, status, created_by, created_at, updated_at
           FROM recruiting_projects
           ${whereClause}
           ORDER BY created_at DESC
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          dataParams,
        );

        return reply.status(200).send({
          data: dataResult.rows,
          total,
          page,
          pageSize,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to list projects');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list projects' });
      }
    },
  );

  // POST /api/projects - create project
  fastify.post(
    '/api/projects',
    {
      preHandler: [fastify.authorize('admin', 'recruiter')],
      schema: createProjectSchema,
    },
    async (
      request: FastifyRequest<{ Body: CreateProjectBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const { title, description, status } = request.body;
        const createdBy = request.user.id;
        const projectStatus = status || 'draft';

        const result = await fastify.db.query(
          `INSERT INTO recruiting_projects (title, description, status, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id, title, description, status, created_by, archived_at, created_at, updated_at`,
          [title, description || null, projectStatus, createdBy],
        );

        fastify.log.info({ projectId: result.rows[0].id, createdBy }, 'Project created');
        return reply.status(201).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to create project');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to create project' });
      }
    },
  );

  // GET /api/projects/:id - get project detail (object-level auth)
  fastify.get(
    '/api/projects/:id',
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
          `SELECT id, title, description, status, created_by, created_at, updated_at
           FROM recruiting_projects
           WHERE id = $1 AND archived_at IS NULL`,
          [id],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Project not found' });
        }

        const access = await checkProjectAccess(fastify.db, id, request.user.id, request.user.role);
        if (!access.allowed) {
          return reply.status(access.status!).send({ error: 'Forbidden', message: access.message });
        }

        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to get project');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get project' });
      }
    },
  );

  // PUT /api/projects/:id - update project
  fastify.put(
    '/api/projects/:id',
    {
      preHandler: [fastify.authorize('admin', 'recruiter')],
      schema: updateProjectSchema,
    },
    async (
      request: FastifyRequest<{ Params: IdParam; Body: UpdateProjectBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        const { title, description, status } = request.body;

        // Check project exists and is not archived
        const existing = await fastify.db.query(
          'SELECT id FROM recruiting_projects WHERE id = $1 AND archived_at IS NULL',
          [id],
        );

        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Project not found' });
        }

        // Object-level: only owner or admin can update
        const access = await checkProjectAccess(fastify.db, id, request.user.id, request.user.role);
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
        if (status !== undefined) {
          setClauses.push(`status = $${paramIndex}`);
          params.push(status);
          paramIndex++;
        }

        setClauses.push(`updated_at = NOW()`);

        params.push(id);
        const result = await fastify.db.query(
          `UPDATE recruiting_projects
           SET ${setClauses.join(', ')}
           WHERE id = $${paramIndex} AND archived_at IS NULL
           RETURNING id, title, description, status, created_by, created_at, updated_at`,
          params,
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Project not found' });
        }

        fastify.log.info({ projectId: id }, 'Project updated');
        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to update project');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update project' });
      }
    },
  );

  // DELETE /api/projects/:id - soft delete (set archived_at = NOW())
  fastify.delete(
    '/api/projects/:id',
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
          `UPDATE recruiting_projects
           SET archived_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND archived_at IS NULL
           RETURNING id`,
          [id],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Project not found' });
        }

        fastify.log.info({ projectId: id }, 'Project archived');
        return reply.status(200).send({ message: 'Project archived successfully' });
      } catch (err) {
        fastify.log.error(err, 'Failed to archive project');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to archive project' });
      }
    },
  );
}
