/**
 * Attachment Service – Behavior Tests
 *
 * Tests metadata extraction (file name, size, page count) and
 * quality check outcomes against configured field rules.
 */

import { validateAttachment, extractMetadata } from '../../../backend/src/../../backend/src/services/attachment.service';

describe('validateAttachment', () => {
  it('should pass for a valid PDF under 10MB', () => {
    const result = validateAttachment('resume.pdf', 5 * 1024 * 1024);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should pass for a valid DOCX', () => {
    const result = validateAttachment('resume.docx', 1024);
    expect(result.valid).toBe(true);
  });

  it('should reject disallowed extensions', () => {
    const result = validateAttachment('resume.exe', 1024);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not allowed');
  });

  it('should reject files over 10MB', () => {
    const result = validateAttachment('resume.pdf', 11 * 1024 * 1024);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('exceeds maximum');
  });

  it('should reject empty files', () => {
    const result = validateAttachment('empty.pdf', 0);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('File is empty');
  });

  it('should report multiple errors at once', () => {
    const result = validateAttachment('bad.txt', 0);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

describe('extractMetadata', () => {
  it('should return file name, size, and type', () => {
    const result = extractMetadata('resume.pdf', 12345);
    expect(result.fileName).toBe('resume.pdf');
    expect(result.fileSize).toBe(12345);
    expect(result.fileType).toBe('pdf');
    expect(result.pageCount).toBeNull(); // No buffer provided
  });

  it('should extract page count from PDF buffer', () => {
    // Build a minimal buffer with two /Type /Page entries
    const pdfContent =
      '%PDF-1.4\n' +
      '1 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [1 0 R 3 0 R] /Count 2 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n';
    const buffer = Buffer.from(pdfContent, 'binary');

    const result = extractMetadata('resume.pdf', buffer.length, buffer);
    expect(result.pageCount).toBe(2);
  });

  it('should return at least 1 page for DOCX buffer without page breaks', () => {
    // A DOCX buffer without explicit page breaks should still count as 1 page
    const docxContent = 'PK some zip content with document body text';
    const buffer = Buffer.from(docxContent, 'binary');

    const result = extractMetadata('resume.docx', buffer.length, buffer);
    // Returns 1 (minimum) since no lastRenderedPageBreak found
    expect(result.pageCount).toBe(1);
  });

  it('should count DOCX pages by lastRenderedPageBreak markers', () => {
    const docxContent =
      'PK...<w:lastRenderedPageBreak/>...content...<w:lastRenderedPageBreak/>...more';
    const buffer = Buffer.from(docxContent, 'binary');

    const result = extractMetadata('resume.docx', buffer.length, buffer);
    expect(result.pageCount).toBe(3); // 2 breaks + 1 = 3 pages
  });

  it('should return null pageCount for PDF without buffer', () => {
    const result = extractMetadata('resume.pdf', 1000);
    expect(result.pageCount).toBeNull();
  });
});
