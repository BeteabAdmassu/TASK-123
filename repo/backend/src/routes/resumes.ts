import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { scanCandidate } from '../services/violation-scanner';
import { createAuditEntry } from '../services/audit.service';
import { config } from '../config';

interface CandidateIdParams {
  candidateId: string;
}

interface ResumeIdParams {
  id: string;
}

interface ResumeBody {
  content: Record<string, unknown>;
}

const resumeBodySchema = {
  body: {
    type: 'object',
    required: ['content'],
    properties: {
      content: { type: 'object' },
    },
    additionalProperties: false,
  },
};

export default async function resumeRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/candidates/:candidateId/resumes - list all resume versions
  fastify.get<{ Params: CandidateIdParams }>(
    '/api/candidates/:candidateId/resumes',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Params: CandidateIdParams }>, reply: FastifyReply) => {
      const { candidateId } = request.params;

      try {
        // Verify candidate exists
        const candidateCheck = await fastify.db.query(
          'SELECT id FROM candidates WHERE id = $1',
          [candidateId]
        );
        if (candidateCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Candidate not found' });
        }

        const result = await fastify.db.query(
          `SELECT rv.*, u.username AS created_by_username
           FROM resume_versions rv
           LEFT JOIN users u ON u.id = rv.created_by
           WHERE rv.candidate_id = $1
           ORDER BY rv.version_number DESC`,
          [candidateId]
        );

        return reply.send({ data: result.rows });
      } catch (err) {
        fastify.log.error({ err, candidateId }, 'Failed to list resume versions');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/candidates/:candidateId/resumes - save new resume version
  fastify.post<{ Params: CandidateIdParams; Body: ResumeBody }>(
    '/api/candidates/:candidateId/resumes',
    { schema: resumeBodySchema, preHandler: [fastify.authorize('admin', 'recruiter')] },
    async (request: FastifyRequest<{ Params: CandidateIdParams; Body: ResumeBody }>, reply: FastifyReply) => {
      const { candidateId } = request.params;
      const { content } = request.body;

      try {
        // Verify candidate exists
        const candidateCheck = await fastify.db.query(
          'SELECT id FROM candidates WHERE id = $1',
          [candidateId]
        );
        if (candidateCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Candidate not found' });
        }

        // Get the current max version number
        const maxResult = await fastify.db.query(
          'SELECT COALESCE(MAX(version_number), 0) AS max_version FROM resume_versions WHERE candidate_id = $1',
          [candidateId]
        );
        const nextVersion = parseInt(maxResult.rows[0].max_version, 10) + 1;

        // Insert the new resume version
        const result = await fastify.db.query(
          `INSERT INTO resume_versions (candidate_id, version_number, content, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [candidateId, nextVersion, JSON.stringify(content), request.user.id]
        );

        const newResume = result.rows[0];

        // FIFO pruning: if versions exceed max, delete the oldest
        const maxVersions = config.resume.maxVersions;
        const countResult = await fastify.db.query(
          'SELECT COUNT(*) FROM resume_versions WHERE candidate_id = $1',
          [candidateId]
        );
        const totalVersions = parseInt(countResult.rows[0].count, 10);

        if (totalVersions > maxVersions) {
          const excessCount = totalVersions - maxVersions;

          const oldestResult = await fastify.db.query(
            `SELECT id, version_number FROM resume_versions
             WHERE candidate_id = $1
             ORDER BY version_number ASC
             LIMIT $2`,
            [candidateId, excessCount]
          );

          for (const oldVersion of oldestResult.rows) {
            await fastify.db.query(
              'DELETE FROM resume_versions WHERE id = $1',
              [oldVersion.id]
            );

            await createAuditEntry(
              fastify.db,
              'resume_version',
              oldVersion.id,
              'auto_pruned',
              request.user.id,
              { version_number: oldVersion.version_number, candidate_id: candidateId },
              null,
              { reason: 'FIFO pruning', max_versions: maxVersions, total_before_prune: totalVersions }
            );

            fastify.log.info(
              { candidateId, prunedVersionId: oldVersion.id, versionNumber: oldVersion.version_number },
              'Resume version auto-pruned (FIFO)'
            );
          }
        }

        await createAuditEntry(
          fastify.db,
          'resume_version',
          newResume.id,
          'create',
          request.user.id,
          null,
          { version_number: nextVersion, candidate_id: candidateId }
        );

        // Trigger violation scan on the candidate after resume save
        const violations = await scanCandidate(fastify.db, candidateId);
        if (violations.length > 0) {
          fastify.log.info(
            { candidateId, violationCount: violations.length },
            'Violations detected after resume version save'
          );
        }

        return reply.status(201).send(newResume);
      } catch (err) {
        fastify.log.error({ err, candidateId }, 'Failed to save resume version');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // GET /api/resumes/:id - get specific resume version
  fastify.get<{ Params: ResumeIdParams }>(
    '/api/resumes/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Params: ResumeIdParams }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const result = await fastify.db.query(
          `SELECT rv.*, u.username AS created_by_username
           FROM resume_versions rv
           LEFT JOIN users u ON u.id = rv.created_by
           WHERE rv.id = $1`,
          [id]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Resume version not found' });
        }

        return reply.send(result.rows[0]);
      } catch (err) {
        fastify.log.error({ err, resumeId: id }, 'Failed to get resume version');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // GET /api/candidates/:candidateId/resumes/latest - get latest version
  fastify.get<{ Params: CandidateIdParams }>(
    '/api/candidates/:candidateId/resumes/latest',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Params: CandidateIdParams }>, reply: FastifyReply) => {
      const { candidateId } = request.params;

      try {
        // Verify candidate exists
        const candidateCheck = await fastify.db.query(
          'SELECT id FROM candidates WHERE id = $1',
          [candidateId]
        );
        if (candidateCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Candidate not found' });
        }

        const result = await fastify.db.query(
          `SELECT rv.*, u.username AS created_by_username
           FROM resume_versions rv
           LEFT JOIN users u ON u.id = rv.created_by
           WHERE rv.candidate_id = $1
           ORDER BY rv.version_number DESC
           LIMIT 1`,
          [candidateId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'No resume versions found for this candidate' });
        }

        return reply.send(result.rows[0]);
      } catch (err) {
        fastify.log.error({ err, candidateId }, 'Failed to get latest resume version');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );
}
