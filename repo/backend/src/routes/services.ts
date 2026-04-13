import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createAuditEntry } from '../services/audit.service';

interface CategoryBody {
  name: string;
  description?: string;
  parent_id?: string;
}

interface AttributeBody {
  name: string;
  data_type: string;
  is_required?: boolean;
}

interface SpecBody {
  name: string;
  description?: string;
  category_id: string;
  duration_minutes: number;
  headcount: number;
  tools_addons?: string[];
  daily_capacity?: number;
}

interface StatusBody {
  status: string;
}

interface TagBody {
  tagId: string;
}

interface IdParam {
  id: string;
}

interface SpecTagParams {
  id: string;
  tagId: string;
}

interface SpecListQuery {
  page?: string;
  pageSize?: string;
  status?: string;
  category_id?: string;
}

// --- JSON Schemas ---

const categoryBodySchema = {
  body: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string' },
      parent_id: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  },
};

const attributeBodySchema = {
  body: {
    type: 'object',
    required: ['name', 'data_type'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      data_type: { type: 'string', minLength: 1, maxLength: 50 },
      is_required: { type: 'boolean' },
    },
    additionalProperties: false,
  },
};

const specBodySchema = {
  body: {
    type: 'object',
    required: ['name', 'category_id', 'duration_minutes', 'headcount'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string' },
      category_id: { type: 'string', format: 'uuid' },
      duration_minutes: { type: 'integer', minimum: 15 },
      headcount: { type: 'integer', minimum: 1, maximum: 20 },
      tools_addons: { type: 'array', items: { type: 'string' }, maxItems: 30 },
      daily_capacity: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
};

const statusBodySchema = {
  body: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['draft', 'active', 'paused', 'retired'] },
    },
    additionalProperties: false,
  },
};

const tagBodySchema = {
  body: {
    type: 'object',
    required: ['tagId'],
    properties: {
      tagId: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  },
};

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['active'],
  active: ['paused', 'retired'],
  paused: ['active'],
};

export default async function servicesRoutes(fastify: FastifyInstance): Promise<void> {

  // ============================================================
  // Service Categories
  // ============================================================

  // GET /api/services/categories - list categories with parent hierarchy
  fastify.get(
    '/api/services/categories',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await fastify.db.query(
          `SELECT c.*, p.name AS parent_name
           FROM service_categories c
           LEFT JOIN service_categories p ON p.id = c.parent_id
           ORDER BY c.name`
        );
        return reply.send({ data: result.rows });
      } catch (err) {
        fastify.log.error({ err }, 'Failed to list service categories');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/services/categories - create category (Admin only)
  fastify.post<{ Body: CategoryBody }>(
    '/api/services/categories',
    { schema: categoryBodySchema, preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Body: CategoryBody }>, reply: FastifyReply) => {
      const { name, description, parent_id } = request.body;

      try {
        // Validate parent_id exists if provided
        if (parent_id) {
          const parentCheck = await fastify.db.query(
            'SELECT id FROM service_categories WHERE id = $1',
            [parent_id]
          );
          if (parentCheck.rows.length === 0) {
            return reply.status(400).send({ error: 'Bad Request', message: 'Parent category not found' });
          }
        }

        const result = await fastify.db.query(
          `INSERT INTO service_categories (name, description, parent_id)
           VALUES ($1, $2, $3) RETURNING *`,
          [name, description || null, parent_id || null]
        );

        const category = result.rows[0];

        await createAuditEntry(
          fastify.db, 'service_category', category.id, 'created',
          request.user.id, null, category
        );

        fastify.log.info({ categoryId: category.id }, 'Service category created');
        return reply.status(201).send(category);
      } catch (err) {
        fastify.log.error({ err }, 'Failed to create service category');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // PUT /api/services/categories/:id - update category (Admin only)
  fastify.put<{ Params: IdParam; Body: CategoryBody }>(
    '/api/services/categories/:id',
    { schema: categoryBodySchema, preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Params: IdParam; Body: CategoryBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { name, description, parent_id } = request.body;

      try {
        const existing = await fastify.db.query(
          'SELECT * FROM service_categories WHERE id = $1',
          [id]
        );
        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Category not found' });
        }

        // Prevent setting parent to self
        if (parent_id && parent_id === id) {
          return reply.status(400).send({ error: 'Bad Request', message: 'Category cannot be its own parent' });
        }

        // Validate parent_id exists if provided
        if (parent_id) {
          const parentCheck = await fastify.db.query(
            'SELECT id FROM service_categories WHERE id = $1',
            [parent_id]
          );
          if (parentCheck.rows.length === 0) {
            return reply.status(400).send({ error: 'Bad Request', message: 'Parent category not found' });
          }
        }

        const result = await fastify.db.query(
          `UPDATE service_categories
           SET name = $1, description = $2, parent_id = $3, updated_at = NOW()
           WHERE id = $4 RETURNING *`,
          [name, description || null, parent_id || null, id]
        );

        const updated = result.rows[0];

        await createAuditEntry(
          fastify.db, 'service_category', id, 'updated',
          request.user.id, existing.rows[0], updated
        );

        fastify.log.info({ categoryId: id }, 'Service category updated');
        return reply.send(updated);
      } catch (err) {
        fastify.log.error({ err, categoryId: id }, 'Failed to update service category');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // DELETE /api/services/categories/:id - delete category (Admin only)
  fastify.delete<{ Params: IdParam }>(
    '/api/services/categories/:id',
    { preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const existing = await fastify.db.query(
          'SELECT * FROM service_categories WHERE id = $1',
          [id]
        );
        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Category not found' });
        }

        // Check for child categories
        const children = await fastify.db.query(
          'SELECT id FROM service_categories WHERE parent_id = $1',
          [id]
        );
        if (children.rows.length > 0) {
          return reply.status(409).send({ error: 'Conflict', message: 'Cannot delete category with child categories' });
        }

        // Check for linked specifications
        const specs = await fastify.db.query(
          'SELECT id FROM service_specifications WHERE category_id = $1',
          [id]
        );
        if (specs.rows.length > 0) {
          return reply.status(409).send({ error: 'Conflict', message: 'Cannot delete category with linked specifications' });
        }

        await fastify.db.query('DELETE FROM service_categories WHERE id = $1', [id]);

        await createAuditEntry(
          fastify.db, 'service_category', id, 'deleted',
          request.user.id, existing.rows[0], null
        );

        fastify.log.info({ categoryId: id }, 'Service category deleted');
        return reply.status(200).send({ message: 'Category deleted' });
      } catch (err) {
        fastify.log.error({ err, categoryId: id }, 'Failed to delete service category');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // GET /api/services/categories/:id/attributes - list attributes for category
  fastify.get<{ Params: IdParam }>(
    '/api/services/categories/:id/attributes',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const catCheck = await fastify.db.query(
          'SELECT id FROM service_categories WHERE id = $1',
          [id]
        );
        if (catCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Category not found' });
        }

        const result = await fastify.db.query(
          'SELECT * FROM service_attributes WHERE category_id = $1 ORDER BY name',
          [id]
        );
        return reply.send({ data: result.rows });
      } catch (err) {
        fastify.log.error({ err, categoryId: id }, 'Failed to list service attributes');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/services/categories/:id/attributes - create attribute (Admin only)
  fastify.post<{ Params: IdParam; Body: AttributeBody }>(
    '/api/services/categories/:id/attributes',
    { schema: attributeBodySchema, preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Params: IdParam; Body: AttributeBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { name, data_type, is_required } = request.body;

      try {
        const catCheck = await fastify.db.query(
          'SELECT id FROM service_categories WHERE id = $1',
          [id]
        );
        if (catCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Category not found' });
        }

        const result = await fastify.db.query(
          `INSERT INTO service_attributes (category_id, name, data_type, is_required)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [id, name, data_type, is_required ?? false]
        );

        const attribute = result.rows[0];

        await createAuditEntry(
          fastify.db, 'service_attribute', attribute.id, 'created',
          request.user.id, null, attribute
        );

        fastify.log.info({ attributeId: attribute.id, categoryId: id }, 'Service attribute created');
        return reply.status(201).send(attribute);
      } catch (err) {
        fastify.log.error({ err, categoryId: id }, 'Failed to create service attribute');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // ============================================================
  // Service Specifications
  // ============================================================

  // GET /api/services/specifications - list specs (paginated, filterable)
  fastify.get<{ Querystring: SpecListQuery }>(
    '/api/services/specifications',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Querystring: SpecListQuery }>, reply: FastifyReply) => {
      const page = Math.max(1, parseInt(request.query.page || '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(request.query.pageSize || '20', 10) || 20));
      const offset = (page - 1) * pageSize;
      const { status, category_id } = request.query;

      try {
        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (status) {
          conditions.push(`s.status = $${paramIdx++}`);
          params.push(status);
        }
        if (category_id) {
          conditions.push(`s.category_id = $${paramIdx++}`);
          params.push(category_id);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await fastify.db.query(
          `SELECT COUNT(*) FROM service_specifications s ${whereClause}`,
          params
        );
        const total = parseInt(countResult.rows[0].count, 10);

        const dataResult = await fastify.db.query(
          `SELECT s.*, c.name AS category_name
           FROM service_specifications s
           LEFT JOIN service_categories c ON c.id = s.category_id
           ${whereClause}
           ORDER BY s.created_at DESC
           LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
          [...params, pageSize, offset]
        );

        return reply.send({
          data: dataResult.rows,
          total,
          page,
          pageSize,
        });
      } catch (err) {
        fastify.log.error({ err }, 'Failed to list service specifications');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/services/specifications - create spec (Admin only)
  fastify.post<{ Body: SpecBody }>(
    '/api/services/specifications',
    { schema: specBodySchema, preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Body: SpecBody }>, reply: FastifyReply) => {
      const { name, description, category_id, duration_minutes, headcount, tools_addons, daily_capacity } = request.body;

      // Custom validations beyond JSON schema
      if (duration_minutes % 15 !== 0) {
        return reply.status(400).send({ error: 'Bad Request', message: 'duration_minutes must be divisible by 15' });
      }

      try {
        // Verify category exists
        const catCheck = await fastify.db.query(
          'SELECT id FROM service_categories WHERE id = $1',
          [category_id]
        );
        if (catCheck.rows.length === 0) {
          return reply.status(400).send({ error: 'Bad Request', message: 'Category not found' });
        }

        const result = await fastify.db.query(
          `INSERT INTO service_specifications
             (name, description, category_id, duration_minutes, headcount, tools_addons, daily_capacity)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [
            name,
            description || null,
            category_id,
            duration_minutes,
            headcount,
            JSON.stringify(tools_addons || []),
            daily_capacity ?? null,
          ]
        );

        const spec = result.rows[0];

        await createAuditEntry(
          fastify.db, 'service_spec', spec.id, 'created',
          request.user.id, null, spec
        );

        fastify.log.info({ specId: spec.id }, 'Service specification created');
        return reply.status(201).send(spec);
      } catch (err) {
        fastify.log.error({ err }, 'Failed to create service specification');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // GET /api/services/specifications/:id - get spec detail
  fastify.get<{ Params: IdParam }>(
    '/api/services/specifications/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const result = await fastify.db.query(
          `SELECT s.*, c.name AS category_name
           FROM service_specifications s
           LEFT JOIN service_categories c ON c.id = s.category_id
           WHERE s.id = $1`,
          [id]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Specification not found' });
        }

        // Fetch tags for this specification
        const tagsResult = await fastify.db.query(
          `SELECT t.* FROM tags t
           JOIN service_tags st ON st.tag_id = t.id
           WHERE st.spec_id = $1
           ORDER BY t.name`,
          [id]
        );

        const spec = { ...result.rows[0], tags: tagsResult.rows };
        return reply.send(spec);
      } catch (err) {
        fastify.log.error({ err, specId: id }, 'Failed to get service specification');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // PUT /api/services/specifications/:id - update spec (Admin only)
  fastify.put<{ Params: IdParam; Body: SpecBody }>(
    '/api/services/specifications/:id',
    { schema: specBodySchema, preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Params: IdParam; Body: SpecBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { name, description, category_id, duration_minutes, headcount, tools_addons, daily_capacity } = request.body;

      if (duration_minutes % 15 !== 0) {
        return reply.status(400).send({ error: 'Bad Request', message: 'duration_minutes must be divisible by 15' });
      }

      try {
        const existing = await fastify.db.query(
          'SELECT * FROM service_specifications WHERE id = $1',
          [id]
        );
        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Specification not found' });
        }

        // Verify category exists
        const catCheck = await fastify.db.query(
          'SELECT id FROM service_categories WHERE id = $1',
          [category_id]
        );
        if (catCheck.rows.length === 0) {
          return reply.status(400).send({ error: 'Bad Request', message: 'Category not found' });
        }

        const result = await fastify.db.query(
          `UPDATE service_specifications
           SET name = $1, description = $2, category_id = $3, duration_minutes = $4,
               headcount = $5, tools_addons = $6, daily_capacity = $7, updated_at = NOW()
           WHERE id = $8 RETURNING *`,
          [
            name,
            description || null,
            category_id,
            duration_minutes,
            headcount,
            JSON.stringify(tools_addons || []),
            daily_capacity ?? null,
            id,
          ]
        );

        const updated = result.rows[0];

        await createAuditEntry(
          fastify.db, 'service_spec', id, 'updated',
          request.user.id, existing.rows[0], updated
        );

        fastify.log.info({ specId: id }, 'Service specification updated');
        return reply.send(updated);
      } catch (err) {
        fastify.log.error({ err, specId: id }, 'Failed to update service specification');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // PUT /api/services/specifications/:id/status - change spec status (Admin only)
  fastify.put<{ Params: IdParam; Body: StatusBody }>(
    '/api/services/specifications/:id/status',
    { schema: statusBodySchema, preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Params: IdParam; Body: StatusBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { status: newStatus } = request.body;

      try {
        const existing = await fastify.db.query(
          'SELECT * FROM service_specifications WHERE id = $1',
          [id]
        );
        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Specification not found' });
        }

        const currentStatus = existing.rows[0].status;
        const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus] || [];

        if (!allowedTransitions.includes(newStatus)) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: `Invalid status transition from '${currentStatus}' to '${newStatus}'. Allowed: ${allowedTransitions.join(', ') || 'none'}`,
          });
        }

        const result = await fastify.db.query(
          `UPDATE service_specifications SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
          [newStatus, id]
        );

        const updated = result.rows[0];

        await createAuditEntry(
          fastify.db, 'service_spec', id, 'status_changed',
          request.user.id, { status: currentStatus }, { status: newStatus }
        );

        fastify.log.info({ specId: id, from: currentStatus, to: newStatus }, 'Specification status changed');
        return reply.send(updated);
      } catch (err) {
        fastify.log.error({ err, specId: id }, 'Failed to change specification status');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/services/specifications/:id/tags - add tag to spec (Admin only)
  fastify.post<{ Params: IdParam; Body: TagBody }>(
    '/api/services/specifications/:id/tags',
    { schema: tagBodySchema, preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Params: IdParam; Body: TagBody }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { tagId } = request.body;

      try {
        // Verify spec exists
        const specCheck = await fastify.db.query(
          'SELECT id FROM service_specifications WHERE id = $1',
          [id]
        );
        if (specCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Specification not found' });
        }

        // Verify tag exists
        const tagCheck = await fastify.db.query(
          'SELECT id, name FROM tags WHERE id = $1',
          [tagId]
        );
        if (tagCheck.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Tag not found' });
        }

        // Check if already linked
        const existingLink = await fastify.db.query(
          'SELECT spec_id FROM service_tags WHERE spec_id = $1 AND tag_id = $2',
          [id, tagId]
        );
        if (existingLink.rows.length > 0) {
          return reply.status(409).send({ error: 'Conflict', message: 'Tag is already assigned to this specification' });
        }

        await fastify.db.query(
          'INSERT INTO service_tags (spec_id, tag_id) VALUES ($1, $2)',
          [id, tagId]
        );

        await createAuditEntry(
          fastify.db, 'service_spec', id, 'tag_added',
          request.user.id, null, { tagId, tagName: tagCheck.rows[0].name }
        );

        fastify.log.info({ specId: id, tagId }, 'Tag added to specification');
        return reply.status(201).send({ message: 'Tag added', spec_id: id, tag_id: tagId });
      } catch (err) {
        fastify.log.error({ err, specId: id, tagId }, 'Failed to add tag to specification');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // DELETE /api/services/specifications/:id/tags/:tagId - remove tag from spec (Admin only)
  fastify.delete<{ Params: SpecTagParams }>(
    '/api/services/specifications/:id/tags/:tagId',
    { preHandler: [fastify.authorize('admin')] },
    async (request: FastifyRequest<{ Params: SpecTagParams }>, reply: FastifyReply) => {
      const { id, tagId } = request.params;

      try {
        const result = await fastify.db.query(
          'DELETE FROM service_tags WHERE spec_id = $1 AND tag_id = $2',
          [id, tagId]
        );

        if (result.rowCount === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Tag assignment not found for this specification' });
        }

        await createAuditEntry(
          fastify.db, 'service_spec', id, 'tag_removed',
          request.user.id, { tagId }, null
        );

        fastify.log.info({ specId: id, tagId }, 'Tag removed from specification');
        return reply.status(200).send({ message: 'Tag removed' });
      } catch (err) {
        fastify.log.error({ err, specId: id, tagId }, 'Failed to remove tag from specification');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );
}
