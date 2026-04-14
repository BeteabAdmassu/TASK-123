import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface SearchQuery {
  q: string;
}

const searchQuerySchema = {
  querystring: {
    type: 'object',
    required: ['q'],
    properties: {
      q: { type: 'string', minLength: 1, maxLength: 200 },
    },
    additionalProperties: false,
  },
};

export default async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/search?q=term - global search across entities
  fastify.get<{ Querystring: SearchQuery }>(
    '/api/search',
    {
      preHandler: [fastify.authenticate],
      schema: searchQuerySchema,
    },
    async (
      request: FastifyRequest<{ Querystring: SearchQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const { q } = request.query;
        const searchTerm = `%${q}%`;
        const userId = request.user.id;
        const userRole = request.user.role;
        const isPrivileged = userRole === 'admin' || userRole === 'reviewer';

        // Search candidates — scoped by project ownership for non-privileged users
        const candidatesResult = isPrivileged
          ? await fastify.db.query(
              `SELECT id, first_name, last_name, email, status
               FROM candidates
               WHERE (first_name ILIKE $1 OR last_name ILIKE $1)
                 AND archived_at IS NULL
               ORDER BY last_name ASC, first_name ASC
               LIMIT 10`,
              [searchTerm])
          : await fastify.db.query(
              `SELECT c.id, c.first_name, c.last_name, c.email, c.status
               FROM candidates c
               JOIN job_postings jp ON jp.id = c.job_posting_id
               JOIN recruiting_projects rp ON rp.id = jp.project_id
               WHERE (c.first_name ILIKE $1 OR c.last_name ILIKE $1)
                 AND c.archived_at IS NULL AND rp.created_by = $2
               ORDER BY c.last_name ASC, c.first_name ASC
               LIMIT 10`,
              [searchTerm, userId]);

        // Search projects — scoped by ownership for non-privileged users
        const projectsResult = isPrivileged
          ? await fastify.db.query(
              `SELECT id, title, status
               FROM recruiting_projects
               WHERE title ILIKE $1 AND archived_at IS NULL
               ORDER BY title ASC LIMIT 10`,
              [searchTerm])
          : await fastify.db.query(
              `SELECT id, title, status
               FROM recruiting_projects
               WHERE title ILIKE $1 AND archived_at IS NULL AND created_by = $2
               ORDER BY title ASC LIMIT 10`,
              [searchTerm, userId]);

        // Search job postings — scoped by project ownership for non-privileged users
        const postingsResult = isPrivileged
          ? await fastify.db.query(
              `SELECT id, title, status FROM job_postings
               WHERE title ILIKE $1 AND archived_at IS NULL
               ORDER BY title ASC LIMIT 10`,
              [searchTerm])
          : await fastify.db.query(
              `SELECT jp.id, jp.title, jp.status FROM job_postings jp
               JOIN recruiting_projects rp ON rp.id = jp.project_id
               WHERE jp.title ILIKE $1 AND jp.archived_at IS NULL AND rp.created_by = $2
               ORDER BY jp.title ASC LIMIT 10`,
              [searchTerm, userId]);

        // Search services — intentionally broader than recruiting scoping.
        // The service catalog is a shared organizational resource visible to all users.
        // Admin/reviewer: all statuses (including draft/retired for management).
        // Non-privileged: only active/paused (the public operational catalog).
        const servicesResult = isPrivileged
          ? await fastify.db.query(
              `SELECT id, name, status FROM service_specifications
               WHERE name ILIKE $1 AND archived_at IS NULL
               ORDER BY name ASC LIMIT 10`,
              [searchTerm])
          : await fastify.db.query(
              `SELECT id, name, status FROM service_specifications
               WHERE name ILIKE $1 AND archived_at IS NULL AND status IN ('active', 'paused')
               ORDER BY name ASC LIMIT 10`,
              [searchTerm]);

        return reply.status(200).send({
          query: q,
          results: {
            candidates: candidatesResult.rows,
            projects: projectsResult.rows,
            postings: postingsResult.rows,
            services: servicesResult.rows,
          },
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to perform search');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to perform search' });
      }
    },
  );
}
