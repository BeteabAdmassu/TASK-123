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
  fastify.get(
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

        // Search candidates by first_name or last_name
        const candidatesResult = await fastify.db.query(
          `SELECT id, first_name, last_name, email, status
           FROM candidates
           WHERE (first_name ILIKE $1 OR last_name ILIKE $1)
             AND archived_at IS NULL
           ORDER BY last_name ASC, first_name ASC
           LIMIT 10`,
          [searchTerm],
        );

        // Search projects by title
        const projectsResult = await fastify.db.query(
          `SELECT id, title, status
           FROM recruiting_projects
           WHERE title ILIKE $1
             AND archived_at IS NULL
           ORDER BY title ASC
           LIMIT 10`,
          [searchTerm],
        );

        // Search job postings by title
        const postingsResult = await fastify.db.query(
          `SELECT id, title, status
           FROM job_postings
           WHERE title ILIKE $1
             AND archived_at IS NULL
           ORDER BY title ASC
           LIMIT 10`,
          [searchTerm],
        );

        // Search services by name
        const servicesResult = await fastify.db.query(
          `SELECT id, name, status
           FROM service_specifications
           WHERE name ILIKE $1
             AND archived_at IS NULL
           ORDER BY name ASC
           LIMIT 10`,
          [searchTerm],
        );

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
