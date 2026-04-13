import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

const ALLOWED_EXTENSIONS = ['.pdf', '.docx'];

export interface AttachmentMetadata {
  fileName: string;
  fileSize: number;
  fileType: string;
  pageCount: number | null;
}

export function validateAttachment(
  fileName: string,
  fileSize: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ext = path.extname(fileName).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    errors.push(`File extension "${ext}" not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }

  if (fileSize > config.upload.attachmentMaxSize) {
    errors.push(`File size ${(fileSize / 1024 / 1024).toFixed(2)}MB exceeds maximum of 10MB`);
  }

  if (fileSize === 0) {
    errors.push('File is empty');
  }

  return { valid: errors.length === 0, errors };
}

export function extractMetadata(fileName: string, fileSize: number): AttachmentMetadata {
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  return {
    fileName,
    fileSize,
    fileType: ext,
    pageCount: null, // Basic extraction - page count when available
  };
}

export async function runQualityChecks(
  db: Pool,
  attachmentId: string,
  candidateId: string,
  fileType: string
): Promise<{ status: string; errors: string[] }> {
  const errors: string[] = [];

  // Check required sections based on job posting field rules
  const candidate = await db.query(
    `SELECT c.*, jp.field_rules
     FROM candidates c
     LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
     WHERE c.id = $1`,
    [candidateId]
  );

  if (candidate.rows.length > 0) {
    const fieldRules = candidate.rows[0].field_rules;
    if (fieldRules && fieldRules.requiredSections) {
      // Quality check: mark as needing review
      errors.push('Required sections verification pending manual review');
    }
  }

  const status = errors.length > 0 ? 'failed' : 'passed';

  await db.query(
    `UPDATE attachments SET quality_status = $1, quality_errors = $2 WHERE id = $3`,
    [status, errors.length > 0 ? JSON.stringify(errors) : null, attachmentId]
  );

  return { status, errors };
}

export function ensureUploadDir(): string {
  const dir = config.upload.uploadDir;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
