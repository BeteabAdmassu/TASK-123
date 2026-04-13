import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface IdParam {
  id: string;
}

interface FeaturesQuery {
  bbox?: string;
  limit?: number;
  cursor?: string;
}

interface AggregateQuery {
  property: string;
}

interface DensityQuery {
  gridSize?: number;
}

interface BufferQuery {
  distance?: number;
  unit?: string;
}

interface RoutesQuery {
  orderBy?: string;
}

interface ImportBody {
  name: string;
  source_type: string;
  file_content: string;
}

const importSchema = {
  body: {
    type: 'object',
    required: ['name', 'source_type', 'file_content'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      source_type: { type: 'string', enum: ['csv', 'geojson', 'gps'] },
      file_content: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
};

const featuresQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      bbox: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
      cursor: { type: 'string' },
    },
    additionalProperties: false,
  },
};

const aggregateQuerySchema = {
  querystring: {
    type: 'object',
    required: ['property'],
    properties: {
      property: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
};

const densityQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      gridSize: { type: 'number', minimum: 0.0001, default: 0.01 },
    },
    additionalProperties: false,
  },
};

const bufferQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      distance: { type: 'number', minimum: 0, default: 1000 },
      unit: { type: 'string', enum: ['meters', 'kilometers', 'miles'], default: 'meters' },
    },
    additionalProperties: false,
  },
};

const routesQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      orderBy: { type: 'string', minLength: 1, default: 'timestamp' },
    },
    additionalProperties: false,
  },
};

function parseGeoJSON(content: string): Array<{ geometry: unknown; properties: Record<string, unknown> }> {
  const parsed = JSON.parse(content);
  const features: Array<{ geometry: unknown; properties: Record<string, unknown> }> = [];

  if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    for (const feature of parsed.features) {
      features.push({
        geometry: feature.geometry,
        properties: feature.properties || {},
      });
    }
  } else if (parsed.type === 'Feature') {
    features.push({
      geometry: parsed.geometry,
      properties: parsed.properties || {},
    });
  }

  return features;
}

function parseCSV(content: string): Array<{ geometry: { type: string; coordinates: number[] }; properties: Record<string, unknown> }> {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const latIdx = headers.findIndex(h => h === 'lat' || h === 'latitude');
  const lngIdx = headers.findIndex(h => h === 'lng' || h === 'lon' || h === 'longitude');

  if (latIdx === -1 || lngIdx === -1) return [];

  const features: Array<{ geometry: { type: string; coordinates: number[] }; properties: Record<string, unknown> }> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const lat = parseFloat(values[latIdx]);
    const lng = parseFloat(values[lngIdx]);

    if (isNaN(lat) || isNaN(lng)) continue;

    const properties: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      if (j !== latIdx && j !== lngIdx) {
        properties[headers[j]] = values[j];
      }
    }

    features.push({
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties,
    });
  }

  return features;
}

export default async function geoRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/geo/datasets - list imported datasets
  fastify.get(
    '/api/geo/datasets',
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await fastify.db.query(
          `SELECT id, name, source_type, file_path, import_status, feature_count, bounds, created_at
           FROM geo_datasets
           ORDER BY created_at DESC`,
        );
        return reply.status(200).send({ data: result.rows });
      } catch (err) {
        fastify.log.error(err, 'Failed to list geo datasets');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list geo datasets' });
      }
    },
  );

  // POST /api/geo/datasets/import - import file
  fastify.post(
    '/api/geo/datasets/import',
    {
      preHandler: [fastify.authenticate],
      schema: importSchema,
    },
    async (
      request: FastifyRequest<{ Body: ImportBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const { name, source_type, file_content } = request.body;

        // Create dataset record
        const datasetResult = await fastify.db.query(
          `INSERT INTO geo_datasets (name, source_type, file_path, import_status)
           VALUES ($1, $2, $3, 'processing')
           RETURNING id, name, source_type, file_path, import_status, feature_count, bounds, created_at`,
          [name, source_type, `uploads/geo/${name}`],
        );

        const dataset = datasetResult.rows[0];
        let features: Array<{ geometry: unknown; properties: Record<string, unknown> }> = [];

        try {
          if (source_type === 'geojson' || source_type === 'gps') {
            features = parseGeoJSON(file_content);
          } else if (source_type === 'csv') {
            features = parseCSV(file_content);
          }

          // Insert features with PostGIS geometry
          for (const feature of features) {
            await fastify.db.query(
              `INSERT INTO geo_features (dataset_id, geometry, properties)
               VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), $3)`,
              [dataset.id, JSON.stringify(feature.geometry), JSON.stringify(feature.properties)],
            );
          }

          // Update dataset with feature count and bounds
          await fastify.db.query(
            `UPDATE geo_datasets
             SET import_status = 'complete',
                 feature_count = $1,
                 bounds = (
                   SELECT jsonb_build_object(
                     'minLng', ST_XMin(ST_Extent(geometry)),
                     'minLat', ST_YMin(ST_Extent(geometry)),
                     'maxLng', ST_XMax(ST_Extent(geometry)),
                     'maxLat', ST_YMax(ST_Extent(geometry))
                   )
                   FROM geo_features WHERE dataset_id = $2
                 )
             WHERE id = $2`,
            [features.length, dataset.id],
          );

          const updatedDataset = await fastify.db.query(
            'SELECT id, name, source_type, file_path, import_status, feature_count, bounds, created_at FROM geo_datasets WHERE id = $1',
            [dataset.id],
          );

          fastify.log.info({ datasetId: dataset.id, featureCount: features.length }, 'Geo dataset imported');
          return reply.status(201).send(updatedDataset.rows[0]);
        } catch (parseErr) {
          await fastify.db.query(
            "UPDATE geo_datasets SET import_status = 'error' WHERE id = $1",
            [dataset.id],
          );
          fastify.log.error(parseErr, 'Failed to parse geo data');
          return reply.status(400).send({ error: 'Bad Request', message: 'Failed to parse file content' });
        }
      } catch (err) {
        fastify.log.error(err, 'Failed to import geo dataset');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to import geo dataset' });
      }
    },
  );

  // GET /api/geo/datasets/:id - get dataset metadata
  fastify.get(
    '/api/geo/datasets/:id',
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
          'SELECT id, name, source_type, file_path, import_status, feature_count, bounds, created_at FROM geo_datasets WHERE id = $1',
          [id],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Dataset not found' });
        }

        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to get geo dataset');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get geo dataset' });
      }
    },
  );

  // DELETE /api/geo/datasets/:id - remove dataset and features
  fastify.delete(
    '/api/geo/datasets/:id',
    {
      preHandler: [fastify.authorize('admin')],
    },
    async (
      request: FastifyRequest<{ Params: IdParam }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;

        const existing = await fastify.db.query(
          'SELECT id FROM geo_datasets WHERE id = $1',
          [id],
        );

        if (existing.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Dataset not found' });
        }

        // Delete features first, then dataset
        await fastify.db.query('DELETE FROM geo_features WHERE dataset_id = $1', [id]);
        await fastify.db.query('DELETE FROM geo_datasets WHERE id = $1', [id]);

        fastify.log.info({ datasetId: id }, 'Geo dataset deleted');
        return reply.status(200).send({ message: 'Dataset deleted successfully' });
      } catch (err) {
        fastify.log.error(err, 'Failed to delete geo dataset');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to delete geo dataset' });
      }
    },
  );

  // GET /api/geo/datasets/:id/features - get features (paginated with cursor, bbox spatial filter)
  fastify.get(
    '/api/geo/datasets/:id/features',
    {
      preHandler: [fastify.authenticate],
      schema: featuresQuerySchema,
    },
    async (
      request: FastifyRequest<{ Params: IdParam; Querystring: FeaturesQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        const limit = request.query.limit || 100;
        const cursor = request.query.cursor;
        const bbox = request.query.bbox;

        // Verify dataset exists
        const datasetResult = await fastify.db.query(
          'SELECT id FROM geo_datasets WHERE id = $1',
          [id],
        );

        if (datasetResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Dataset not found' });
        }

        const conditions: string[] = ['gf.dataset_id = $1'];
        const params: unknown[] = [id];
        let paramIndex = 2;

        if (cursor) {
          conditions.push(`gf.id > $${paramIndex}`);
          params.push(cursor);
          paramIndex++;
        }

        if (bbox) {
          const parts = bbox.split(',').map(Number);
          if (parts.length === 4 && parts.every(p => !isNaN(p))) {
            conditions.push(
              `ST_Intersects(gf.geometry, ST_MakeEnvelope($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, 4326))`,
            );
            params.push(parts[0], parts[1], parts[2], parts[3]);
            paramIndex += 4;
          }
        }

        params.push(limit);

        const result = await fastify.db.query(
          `SELECT gf.id, gf.dataset_id,
                  ST_AsGeoJSON(gf.geometry)::jsonb AS geometry,
                  gf.properties
           FROM geo_features gf
           WHERE ${conditions.join(' AND ')}
           ORDER BY gf.id ASC
           LIMIT $${paramIndex}`,
          params,
        );

        const nextCursor = result.rows.length === limit ? result.rows[result.rows.length - 1].id : null;

        return reply.status(200).send({
          data: result.rows,
          nextCursor,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to get geo features');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get geo features' });
      }
    },
  );

  // GET /api/geo/datasets/:id/aggregate - administrative-region aggregation
  fastify.get(
    '/api/geo/datasets/:id/aggregate',
    {
      preHandler: [fastify.authenticate],
      schema: aggregateQuerySchema,
    },
    async (
      request: FastifyRequest<{ Params: IdParam; Querystring: AggregateQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        const { property } = request.query;

        const datasetResult = await fastify.db.query(
          'SELECT id FROM geo_datasets WHERE id = $1',
          [id],
        );

        if (datasetResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Dataset not found' });
        }

        const result = await fastify.db.query(
          `SELECT properties->>$1 AS group_value, COUNT(*) AS feature_count
           FROM geo_features
           WHERE dataset_id = $2
           GROUP BY properties->>$1
           ORDER BY feature_count DESC`,
          [property, id],
        );

        return reply.status(200).send({
          property,
          groups: result.rows,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to aggregate geo features');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to aggregate geo features' });
      }
    },
  );

  // GET /api/geo/datasets/:id/density - POI density analysis
  fastify.get(
    '/api/geo/datasets/:id/density',
    {
      preHandler: [fastify.authenticate],
      schema: densityQuerySchema,
    },
    async (
      request: FastifyRequest<{ Params: IdParam; Querystring: DensityQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        const gridSize = request.query.gridSize || 0.01;

        const datasetResult = await fastify.db.query(
          'SELECT id FROM geo_datasets WHERE id = $1',
          [id],
        );

        if (datasetResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Dataset not found' });
        }

        // Grid-based density counting
        const result = await fastify.db.query(
          `SELECT
             FLOOR(ST_X(geometry) / $1) * $1 AS grid_lng,
             FLOOR(ST_Y(geometry) / $1) * $1 AS grid_lat,
             COUNT(*) AS point_count
           FROM geo_features
           WHERE dataset_id = $2
           GROUP BY grid_lng, grid_lat
           ORDER BY point_count DESC`,
          [gridSize, id],
        );

        return reply.status(200).send({
          gridSize,
          cells: result.rows,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to compute density');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to compute density' });
      }
    },
  );

  // GET /api/geo/datasets/:id/buffer - buffer analysis around features
  fastify.get(
    '/api/geo/datasets/:id/buffer',
    {
      preHandler: [fastify.authenticate],
      schema: bufferQuerySchema,
    },
    async (
      request: FastifyRequest<{ Params: IdParam; Querystring: BufferQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        let distance = request.query.distance || 1000;
        const unit = request.query.unit || 'meters';

        const datasetResult = await fastify.db.query(
          'SELECT id FROM geo_datasets WHERE id = $1',
          [id],
        );

        if (datasetResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Dataset not found' });
        }

        // Convert to meters for ST_Buffer with geography cast
        if (unit === 'kilometers') {
          distance = distance * 1000;
        } else if (unit === 'miles') {
          distance = distance * 1609.344;
        }

        const result = await fastify.db.query(
          `SELECT gf.id, gf.properties,
                  ST_AsGeoJSON(ST_Buffer(gf.geometry::geography, $1)::geometry)::jsonb AS buffer_geometry
           FROM geo_features gf
           WHERE gf.dataset_id = $2
           ORDER BY gf.id ASC
           LIMIT 500`,
          [distance, id],
        );

        return reply.status(200).send({
          distance,
          unit,
          data: result.rows,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to compute buffer');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to compute buffer' });
      }
    },
  );

  // GET /api/geo/datasets/:id/routes - route/trajectory display
  fastify.get(
    '/api/geo/datasets/:id/routes',
    {
      preHandler: [fastify.authenticate],
      schema: routesQuerySchema,
    },
    async (
      request: FastifyRequest<{ Params: IdParam; Querystring: RoutesQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        const orderBy = request.query.orderBy || 'timestamp';

        const datasetResult = await fastify.db.query(
          'SELECT id FROM geo_datasets WHERE id = $1',
          [id],
        );

        if (datasetResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Dataset not found' });
        }

        // Return features ordered by specified property for trajectory reconstruction
        const result = await fastify.db.query(
          `SELECT gf.id, gf.properties,
                  ST_AsGeoJSON(gf.geometry)::jsonb AS geometry
           FROM geo_features gf
           WHERE gf.dataset_id = $1
           ORDER BY gf.properties->>$2 ASC NULLS LAST
           LIMIT 10000`,
          [id, orderBy],
        );

        return reply.status(200).send({ data: result.rows });
      } catch (err) {
        fastify.log.error(err, 'Failed to get route features');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get route features' });
      }
    },
  );
}
