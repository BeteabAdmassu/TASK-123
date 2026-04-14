import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface IdParam {
  id: string;
}

interface ListMediaQuery {
  page?: number;
  pageSize?: number;
}

interface SavePlaybackBody {
  position_seconds: number;
  playback_speed?: number;
  selected_quality?: string;
}

const listMediaQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
    additionalProperties: false,
  },
};

const savePlaybackSchema = {
  body: {
    type: 'object',
    required: ['position_seconds'],
    properties: {
      position_seconds: { type: 'number', minimum: 0 },
      playback_speed: { type: 'number', minimum: 0.25, maximum: 4.0 },
      selected_quality: { type: 'string', maxLength: 20 },
    },
    additionalProperties: false,
  },
};

export default async function mediaRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/media - list media assets
  fastify.get<{ Querystring: ListMediaQuery }>(
    '/api/media',
    {
      preHandler: [fastify.authenticate],
      schema: listMediaQuerySchema,
    },
    async (
      request: FastifyRequest<{ Querystring: ListMediaQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const page = request.query.page || 1;
        const pageSize = request.query.pageSize || 25;
        const offset = (page - 1) * pageSize;

        const countResult = await fastify.db.query(
          'SELECT COUNT(*) AS total FROM media_assets',
        );
        const total = parseInt(countResult.rows[0].total, 10);

        const dataResult = await fastify.db.query(
          `SELECT id, title, file_path, format, duration_seconds, subtitle_paths, created_at
           FROM media_assets
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
          [pageSize, offset],
        );

        return reply.status(200).send({
          data: dataResult.rows,
          total,
          page,
          pageSize,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to list media assets');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list media assets' });
      }
    },
  );

  // GET /api/media/:id - get media detail with manifest path
  fastify.get(
    '/api/media/:id',
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
          `SELECT id, title, file_path, format, duration_seconds, subtitle_paths, created_at
           FROM media_assets
           WHERE id = $1`,
          [id],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Media asset not found' });
        }

        const asset = result.rows[0];
        // Construct manifest path based on format
        const manifestPath = asset.format === 'hls'
          ? `${asset.file_path}/master.m3u8`
          : `${asset.file_path}/manifest.mpd`;

        return reply.status(200).send({
          ...asset,
          manifest_path: manifestPath,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to get media asset');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get media asset' });
      }
    },
  );

  // GET /api/media/:id/playback-state - get playback state for current user
  fastify.get(
    '/api/media/:id/playback-state',
    {
      preHandler: [fastify.authenticate],
    },
    async (
      request: FastifyRequest<{ Params: IdParam }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        const userId = request.user.id;

        // Verify asset exists
        const assetResult = await fastify.db.query(
          'SELECT id FROM media_assets WHERE id = $1',
          [id],
        );

        if (assetResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Media asset not found' });
        }

        const result = await fastify.db.query(
          `SELECT id, user_id, asset_id, position_seconds, playback_speed, selected_quality, updated_at
           FROM playback_states
           WHERE user_id = $1 AND asset_id = $2`,
          [userId, id],
        );

        if (result.rows.length === 0) {
          return reply.status(200).send({
            user_id: userId,
            asset_id: id,
            position_seconds: 0,
            playback_speed: 1.0,
            selected_quality: null,
            updated_at: null,
          });
        }

        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to get playback state');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get playback state' });
      }
    },
  );

  // PUT /api/media/:id/playback-state - save/update playback state (UPSERT on user_id, asset_id)
  fastify.put<{ Params: IdParam; Body: SavePlaybackBody }>(
    '/api/media/:id/playback-state',
    {
      preHandler: [fastify.authenticate],
      schema: savePlaybackSchema,
    },
    async (
      request: FastifyRequest<{ Params: IdParam; Body: SavePlaybackBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = request.params;
        const { position_seconds, playback_speed, selected_quality } = request.body;
        const userId = request.user.id;

        // Verify asset exists
        const assetResult = await fastify.db.query(
          'SELECT id FROM media_assets WHERE id = $1',
          [id],
        );

        if (assetResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Media asset not found' });
        }

        const speed = playback_speed !== undefined ? playback_speed : 1.0;
        const quality = selected_quality !== undefined ? selected_quality : null;

        const result = await fastify.db.query(
          `INSERT INTO playback_states (user_id, asset_id, position_seconds, playback_speed, selected_quality)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, asset_id)
           DO UPDATE SET
             position_seconds = EXCLUDED.position_seconds,
             playback_speed = EXCLUDED.playback_speed,
             selected_quality = EXCLUDED.selected_quality,
             updated_at = NOW()
           RETURNING id, user_id, asset_id, position_seconds, playback_speed, selected_quality, updated_at`,
          [userId, id, position_seconds, speed, quality],
        );

        fastify.log.info({ userId, assetId: id, position: position_seconds }, 'Playback state saved');
        return reply.status(200).send(result.rows[0]);
      } catch (err) {
        fastify.log.error(err, 'Failed to save playback state');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to save playback state' });
      }
    },
  );

  // GET /api/media/:id/subtitles - list subtitle tracks
  fastify.get(
    '/api/media/:id/subtitles',
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
          'SELECT id, subtitle_paths FROM media_assets WHERE id = $1',
          [id],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Media asset not found' });
        }

        const subtitles = result.rows[0].subtitle_paths || [];

        return reply.status(200).send({ data: subtitles });
      } catch (err) {
        fastify.log.error(err, 'Failed to list subtitles');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list subtitles' });
      }
    },
  );
}
