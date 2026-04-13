import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createAuditEntry } from '../services/audit.service';

interface CapacityBody {
  date: string;
  max_volume: number;
}

interface CapacityUpdateBody {
  date?: string;
  max_volume?: number;
  is_stopped?: boolean;
}

interface SpecIdParam {
  id: string;
}

interface CapacityIdParam {
  id: string;
}

interface CapacityQuery {
  date?: string;
}

const capacityBodySchema = {
  body: {
    type: 'object',
    required: ['date', 'max_volume'],
    properties: {
      date: { type: 'string', format: 'date' },
      max_volume: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
};

const capacityUpdateBodySchema = {
  body: {
    type: 'object',
    properties: {
      date: { type: 'string', format: 'date' },
      max_volume: { type: 'integer', minimum: 0 },
      is_stopped: { type: 'boolean' },
    },
    additionalProperties: false,
  },
};

export default async function capacityRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/services/specifications/:id/capacity - get capacity plan for spec
  fastify.get<{ Params: SpecIdParam; Querystring: CapacityQuery }>(
    '/api/services/specifications/:id/capacity',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Params: SpecIdParam; Querystring: CapacityQuery }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { date } = request.query;

      try {
        // Verify spec exists
        const specCheck = await fastify.db.query(
          'SELECT id FROM service_specifications WHERE id = $1',
          [id]
        );
        if (specCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Specification not found' });
        }

        let query: string;
        let params: unknown[];

        if (date) {
          query = 'SELECT * FROM capacity_plans WHERE spec_id = $1 AND date = $2 ORDER BY date';
          params = [id, date];
        } else {
          query = 'SELECT * FROM capacity_plans WHERE spec_id = $1 ORDER BY date';
          params = [id];
        }

        const result = await fastify.db.query(query, params);
        return reply.send({ data: result.rows });
      } catch (err) {
        fastify.log.error({ err, specId: id }, 'Failed to get capacity plans');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/services/specifications/:id/capacity - set daily capacity (UPSERT, Admin only)
  fastify.post<{ Params: SpecIdParam; Body: CapacityBody }>(
    '/api/services/specifications/:id/capacity',
    { schema: capacityBodySchema, preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Params: SpecIdParam; Body: CapacityBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { date, max_volume } = request.body;

      try {
        // Verify spec exists
        const specCheck = await fastify.db.query(
          'SELECT id FROM service_specifications WHERE id = $1',
          [id]
        );
        if (specCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Specification not found' });
        }

        // Check if an entry already exists for this spec+date
        const existing = await fastify.db.query(
          'SELECT * FROM capacity_plans WHERE spec_id = $1 AND date = $2',
          [id, date]
        );

        let plan;
        let action: string;

        if (existing.rows.length > 0) {
          // UPSERT - update existing
          const result = await fastify.db.query(
            `UPDATE capacity_plans SET max_volume = $1 WHERE spec_id = $2 AND date = $3 RETURNING *`,
            [max_volume, id, date]
          );
          plan = result.rows[0];
          action = 'updated';

          await createAuditEntry(
            fastify.db, 'capacity_plan', plan.id, 'upsert_updated',
            request.user.id, existing.rows[0], plan
          );
        } else {
          // Insert new
          const result = await fastify.db.query(
            `INSERT INTO capacity_plans (spec_id, date, max_volume)
             VALUES ($1, $2, $3) RETURNING *`,
            [id, date, max_volume]
          );
          plan = result.rows[0];
          action = 'created';

          await createAuditEntry(
            fastify.db, 'capacity_plan', plan.id, 'upsert_created',
            request.user.id, null, plan
          );
        }

        fastify.log.info({ planId: plan.id, specId: id, action }, 'Capacity plan set');
        return reply.status(action === 'created' ? 201 : 200).send(plan);
      } catch (err) {
        fastify.log.error({ err, specId: id }, 'Failed to set capacity plan');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // PUT /api/services/capacity/:id - update capacity plan (Admin only)
  fastify.put<{ Params: CapacityIdParam; Body: CapacityUpdateBody }>(
    '/api/services/capacity/:id',
    { schema: capacityUpdateBodySchema, preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Params: CapacityIdParam; Body: CapacityUpdateBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { date, max_volume, is_stopped } = request.body;

      try {
        const existing = await fastify.db.query(
          'SELECT * FROM capacity_plans WHERE id = $1',
          [id]
        );
        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Capacity plan not found' });
        }

        const current = existing.rows[0];
        const newDate = date ?? current.date;
        const newMaxVolume = max_volume ?? current.max_volume;
        const newIsStopped = is_stopped ?? current.is_stopped;

        // If date is changing, check uniqueness constraint
        if (date && date !== current.date) {
          const duplicate = await fastify.db.query(
            'SELECT id FROM capacity_plans WHERE spec_id = $1 AND date = $2 AND id != $3',
            [current.spec_id, date, id]
          );
          if (duplicate.rows.length > 0) {
            return reply.status(409).send({ error: 'Conflict', message: 'A capacity plan already exists for this specification and date' });
          }
        }

        const result = await fastify.db.query(
          `UPDATE capacity_plans
           SET date = $1, max_volume = $2, is_stopped = $3
           WHERE id = $4 RETURNING *`,
          [newDate, newMaxVolume, newIsStopped, id]
        );

        const updated = result.rows[0];

        await createAuditEntry(
          fastify.db, 'capacity_plan', id, 'updated',
          request.user.id, current, updated
        );

        fastify.log.info({ planId: id }, 'Capacity plan updated');
        return reply.send(updated);
      } catch (err) {
        fastify.log.error({ err, planId: id }, 'Failed to update capacity plan');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );
}
