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

/**
 * Count pages in a PDF buffer by searching for /Type /Page entries
 * that are not /Type /Pages (the page tree node).
 */
function countPdfPages(buffer: Buffer): number | null {
  try {
    const content = buffer.toString('binary');
    // Match /Type /Page but not /Type /Pages
    const matches = content.match(/\/Type\s*\/Page(?!s)/g);
    return matches ? matches.length : null;
  } catch {
    return null;
  }
}

/**
 * Count pages in a DOCX buffer by looking for page break markers
 * in the raw ZIP content. DOCX is a ZIP containing XML files.
 * We look for <w:lastRenderedPageBreak/> entries plus 1.
 * Returns null if unable to determine.
 */
function countDocxPages(buffer: Buffer): number | null {
  try {
    const content = buffer.toString('binary');
    const breaks = content.match(/lastRenderedPageBreak/g);
    return breaks ? breaks.length + 1 : 1; // At least 1 page if valid DOCX
  } catch {
    return null;
  }
}

export function extractMetadata(fileName: string, fileSize: number, fileBuffer?: Buffer): AttachmentMetadata {
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  let pageCount: number | null = null;

  if (fileBuffer) {
    if (ext === 'pdf') {
      pageCount = countPdfPages(fileBuffer);
    } else if (ext === 'docx') {
      pageCount = countDocxPages(fileBuffer);
    }
  }

  return {
    fileName,
    fileSize,
    fileType: ext,
    pageCount,
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
      const requiredSections: string[] = fieldRules.requiredSections;

      // Retrieve the attachment file to check content
      const attachmentRow = await db.query(
        'SELECT file_path FROM attachments WHERE id = $1',
        [attachmentId]
      );

      if (attachmentRow.rows.length > 0 && fs.existsSync(attachmentRow.rows[0].file_path)) {
        const fileContent = fs.readFileSync(attachmentRow.rows[0].file_path);
        const textContent = fileContent.toString('binary').toLowerCase();

        for (const section of requiredSections) {
          const sectionLower = section.toLowerCase();
          if (!textContent.includes(sectionLower)) {
            errors.push(`Required section missing: "${section}"`);
          }
        }
      } else {
        errors.push('Unable to read attachment file for quality check');
      }
    }
  }

  // Validate file type is allowed
  if (!['pdf', 'docx'].includes(fileType)) {
    errors.push(`Unsupported file type for quality check: ${fileType}`);
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
