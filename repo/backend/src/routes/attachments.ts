import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  validateAttachment,
  extractMetadata,
  runQualityChecks,
  ensureUploadDir,
} from '../services/attachment.service';
import { createAuditEntry } from '../services/audit.service';

interface CandidateIdParams {
  candidateId: string;
}

interface AttachmentIdParams {
  id: string;
}

export default async function attachmentRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/candidates/:candidateId/attachments - list attachments
  fastify.get<{ Params: CandidateIdParams }>(
    '/api/candidates/:candidateId/attachments',
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
          `SELECT id, candidate_id, file_name, file_size, file_type, page_count, quality_status, quality_errors, created_at
           FROM attachments
           WHERE candidate_id = $1
           ORDER BY created_at DESC`,
          [candidateId]
        );

        return reply.send({ data: result.rows });
      } catch (err) {
        fastify.log.error({ err, candidateId }, 'Failed to list attachments');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // POST /api/candidates/:candidateId/attachments - upload attachment
  fastify.post<{ Params: CandidateIdParams }>(
    '/api/candidates/:candidateId/attachments',
    { preHandler: [fastify.authorize('admin', 'recruiter')] },
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

        // Parse multipart file upload
        const data = await request.file();
        if (!data) {
          return reply.status(400).send({ error: 'Bad Request', message: 'No file uploaded' });
        }

        const originalFileName = data.filename;
        const fileBuffer = await data.toBuffer();
        const fileSize = fileBuffer.length;

        // Validate file
        const validation = validateAttachment(originalFileName, fileSize);
        if (!validation.valid) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'File validation failed',
            details: validation.errors,
          });
        }

        // Ensure upload directory exists
        const uploadDir = ensureUploadDir();

        // Generate unique file name to avoid collisions
        const fileExt = path.extname(originalFileName).toLowerCase();
        const uniqueName = `${candidateId}_${crypto.randomUUID()}${fileExt}`;
        const filePath = path.join(uploadDir, uniqueName);

        // Write file to disk
        fs.writeFileSync(filePath, fileBuffer);

        // Extract metadata
        const metadata = extractMetadata(originalFileName, fileSize);

        // Insert attachment record
        const result = await fastify.db.query(
          `INSERT INTO attachments (candidate_id, file_name, file_path, file_size, file_type, page_count, quality_status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending')
           RETURNING *`,
          [candidateId, metadata.fileName, filePath, metadata.fileSize, metadata.fileType, metadata.pageCount]
        );

        const attachment = result.rows[0];

        // Run quality checks
        const qualityResult = await runQualityChecks(
          fastify.db,
          attachment.id,
          candidateId,
          metadata.fileType
        );

        await createAuditEntry(
          fastify.db,
          'attachment',
          attachment.id,
          'upload',
          request.user.id,
          null,
          {
            file_name: metadata.fileName,
            file_size: metadata.fileSize,
            file_type: metadata.fileType,
            quality_status: qualityResult.status,
          },
          { candidate_id: candidateId }
        );

        fastify.log.info(
          { candidateId, attachmentId: attachment.id, fileName: metadata.fileName, qualityStatus: qualityResult.status },
          'Attachment uploaded'
        );

        // Re-fetch to get updated quality status
        const updated = await fastify.db.query(
          'SELECT id, candidate_id, file_name, file_size, file_type, page_count, quality_status, quality_errors, created_at FROM attachments WHERE id = $1',
          [attachment.id]
        );

        return reply.status(201).send(updated.rows[0]);
      } catch (err) {
        fastify.log.error({ err, candidateId }, 'Failed to upload attachment');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // GET /api/attachments/:id - get attachment metadata
  fastify.get<{ Params: AttachmentIdParams }>(
    '/api/attachments/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Params: AttachmentIdParams }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const result = await fastify.db.query(
          'SELECT id, candidate_id, file_name, file_size, file_type, page_count, quality_status, quality_errors, created_at FROM attachments WHERE id = $1',
          [id]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Attachment not found' });
        }

        return reply.send(result.rows[0]);
      } catch (err) {
        fastify.log.error({ err, attachmentId: id }, 'Failed to get attachment');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // GET /api/attachments/:id/download - stream the file
  fastify.get<{ Params: AttachmentIdParams }>(
    '/api/attachments/:id/download',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest<{ Params: AttachmentIdParams }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const result = await fastify.db.query(
          'SELECT file_name, file_path, file_type FROM attachments WHERE id = $1',
          [id]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Attachment not found' });
        }

        const attachment = result.rows[0];

        if (!fs.existsSync(attachment.file_path)) {
          fastify.log.error({ attachmentId: id, filePath: attachment.file_path }, 'Attachment file not found on disk');
          return reply.status(404).send({ error: 'Not Found', message: 'Attachment file not found on disk' });
        }

        const mimeTypes: Record<string, string> = {
          pdf: 'application/pdf',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };

        const contentType = mimeTypes[attachment.file_type] || 'application/octet-stream';
        const stream = fs.createReadStream(attachment.file_path);

        return reply
          .header('Content-Type', contentType)
          .header('Content-Disposition', `attachment; filename="${attachment.file_name}"`)
          .send(stream);
      } catch (err) {
        fastify.log.error({ err, attachmentId: id }, 'Failed to download attachment');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );

  // DELETE /api/attachments/:id - delete attachment and its file
  fastify.delete<{ Params: AttachmentIdParams }>(
    '/api/attachments/:id',
    { preHandler: [fastify.authorize('admin', 'recruiter')] },
    async (request: FastifyRequest<{ Params: AttachmentIdParams }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        // Fetch attachment to get file path before deleting
        const result = await fastify.db.query(
          'SELECT * FROM attachments WHERE id = $1',
          [id]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'Attachment not found' });
        }

        const attachment = result.rows[0];

        // Delete from database
        await fastify.db.query(
          'DELETE FROM attachments WHERE id = $1',
          [id]
        );

        // Delete from disk
        if (fs.existsSync(attachment.file_path)) {
          fs.unlinkSync(attachment.file_path);
          fastify.log.info({ attachmentId: id, filePath: attachment.file_path }, 'Attachment file deleted from disk');
        } else {
          fastify.log.warn({ attachmentId: id, filePath: attachment.file_path }, 'Attachment file not found on disk during deletion');
        }

        await createAuditEntry(
          fastify.db,
          'attachment',
          id,
          'delete',
          request.user.id,
          {
            file_name: attachment.file_name,
            file_size: attachment.file_size,
            file_type: attachment.file_type,
            candidate_id: attachment.candidate_id,
          },
          null
        );

        fastify.log.info({ attachmentId: id, candidateId: attachment.candidate_id }, 'Attachment deleted');

        return reply.status(204).send();
      } catch (err) {
        fastify.log.error({ err, attachmentId: id }, 'Failed to delete attachment');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
      }
    }
  );
}
