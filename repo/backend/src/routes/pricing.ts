import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createAuditEntry } from '../services/audit.service';

interface PricingBody {
  rule_type: string;
  base_price?: number;
  tier_config?: Record<string, unknown>[];
  surcharge_label?: string;
  surcharge_amount?: number;
}

interface SpecIdParam {
  id: string;
}

interface PricingIdParam {
  id: string;
}

const pricingBodySchema = {
  body: {
    type: 'object',
    required: ['rule_type'],
    properties: {
      rule_type: { type: 'string', enum: ['base', 'tiered', 'surcharge'] },
      base_price: { type: 'number', minimum: 0 },
      tier_config: { type: 'array', items: { type: 'object' } },
      surcharge_label: { type: 'string', minLength: 1, maxLength: 255 },
      surcharge_amount: { type: 'number' },
    },
    additionalProperties: false,
  },
};

function validatePricingFields(body: PricingBody): string | null {
  switch (body.rule_type) {
    case 'base':
      if (body.base_price === undefined || body.base_price === null) {
        return 'base_price is required for rule_type "base"';
      }
      break;
    case 'tiered':
      if (!body.tier_config || !Array.isArray(body.tier_config) || body.tier_config.length === 0) {
        return 'tier_config is required and must be a non-empty array for rule_type "tiered"';
      }
      break;
    case 'surcharge':
      if (!body.surcharge_label) {
        return 'surcharge_label is required for rule_type "surcharge"';
      }
      if (body.surcharge_amount === undefined || body.surcharge_amount === null) {
        return 'surcharge_amount is required for rule_type "surcharge"';
      }
      break;
    default:
      return `Invalid rule_type: ${body.rule_type}`;
  }
  return null;
}

export default async function pricingRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/services/specifications/:id/pricing - list pricing rules for a spec
  fastify.get<{ Params: SpecIdParam }>(
    '/api/services/specifications/:id/pricing',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Params: SpecIdParam }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        // Verify spec exists
        const specCheck = await fastify.db.query(
          'SELECT id FROM service_specifications WHERE id = $1',
          [id]
        );
        if (specCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Specification not found' });
        }

        const result = await fastify.db.query(
          'SELECT * FROM pricing_rules WHERE spec_id = $1 ORDER BY created_at',
          [id]
        );

        return reply.send({ data: result.rows });
      } catch (err) {
        fastify.log.error({ err, specId: id }, 'Failed to list pricing rules');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/services/specifications/:id/pricing - create pricing rule (Admin only)
  fastify.post<{ Params: SpecIdParam; Body: PricingBody }>(
    '/api/services/specifications/:id/pricing',
    { schema: pricingBodySchema, preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Params: SpecIdParam; Body: PricingBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const body = request.body;

      // Validate rule-type-specific fields
      const validationError = validatePricingFields(body);
      if (validationError) {
        return reply.status(400).send({ error: 'Bad Request', message: validationError });
      }

      try {
        // Verify spec exists
        const specCheck = await fastify.db.query(
          'SELECT id FROM service_specifications WHERE id = $1',
          [id]
        );
        if (specCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Specification not found' });
        }

        const result = await fastify.db.query(
          `INSERT INTO pricing_rules (spec_id, rule_type, base_price, tier_config, surcharge_label, surcharge_amount)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [
            id,
            body.rule_type,
            body.base_price ?? null,
            body.tier_config ? JSON.stringify(body.tier_config) : null,
            body.surcharge_label || null,
            body.surcharge_amount ?? null,
          ]
        );

        const rule = result.rows[0];

        await createAuditEntry(
          fastify.db, 'pricing_rule', rule.id, 'created',
          request.user.id, null, rule
        );

        fastify.log.info({ ruleId: rule.id, specId: id }, 'Pricing rule created');
        return reply.status(201).send(rule);
      } catch (err) {
        fastify.log.error({ err, specId: id }, 'Failed to create pricing rule');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // PUT /api/services/pricing/:id - update pricing rule (Admin only)
  fastify.put<{ Params: PricingIdParam; Body: PricingBody }>(
    '/api/services/pricing/:id',
    { schema: pricingBodySchema, preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Params: PricingIdParam; Body: PricingBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const body = request.body;

      // Validate rule-type-specific fields
      const validationError = validatePricingFields(body);
      if (validationError) {
        return reply.status(400).send({ error: 'Bad Request', message: validationError });
      }

      try {
        const existing = await fastify.db.query(
          'SELECT * FROM pricing_rules WHERE id = $1',
          [id]
        );
        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Pricing rule not found' });
        }

        const result = await fastify.db.query(
          `UPDATE pricing_rules
           SET rule_type = $1, base_price = $2, tier_config = $3, surcharge_label = $4, surcharge_amount = $5
           WHERE id = $6 RETURNING *`,
          [
            body.rule_type,
            body.base_price ?? null,
            body.tier_config ? JSON.stringify(body.tier_config) : null,
            body.surcharge_label || null,
            body.surcharge_amount ?? null,
            id,
          ]
        );

        const updated = result.rows[0];

        await createAuditEntry(
          fastify.db, 'pricing_rule', id, 'updated',
          request.user.id, existing.rows[0], updated
        );

        fastify.log.info({ ruleId: id }, 'Pricing rule updated');
        return reply.send(updated);
      } catch (err) {
        fastify.log.error({ err, ruleId: id }, 'Failed to update pricing rule');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // DELETE /api/services/pricing/:id - delete pricing rule (Admin only)
  fastify.delete<{ Params: PricingIdParam }>(
    '/api/services/pricing/:id',
    { preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Params: PricingIdParam }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const existing = await fastify.db.query(
          'SELECT * FROM pricing_rules WHERE id = $1',
          [id]
        );
        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Pricing rule not found' });
        }

        await fastify.db.query('DELETE FROM pricing_rules WHERE id = $1', [id]);

        await createAuditEntry(
          fastify.db, 'pricing_rule', id, 'deleted',
          request.user.id, existing.rows[0], null
        );

        fastify.log.info({ ruleId: id }, 'Pricing rule deleted');
        return reply.status(200).send({ message: 'Pricing rule deleted' });
      } catch (err) {
        fastify.log.error({ err, ruleId: id }, 'Failed to delete pricing rule');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );
}
