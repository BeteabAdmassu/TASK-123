/**
 * Attachment Service – Behavior Tests
 *
 * Tests metadata extraction (file name, size, page count) and
 * quality check outcomes against configured field rules.
 */

// jest.mock is hoisted before imports, replacing non-configurable fs properties
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

import * as fs from 'fs';
import { validateAttachment, extractMetadata, runQualityChecks, ensureUploadDir } from '../../../backend/src/../../backend/src/services/attachment.service';

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

describe('runQualityChecks', () => {
  afterEach(() => jest.resetAllMocks());

  it('should return passed with no errors when candidate is not found', async () => {
    const mockQuery = jest.fn();
    // Candidate query returns empty rows
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // UPDATE attachments (no file_rules branch entered)
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const mockDb = { query: mockQuery };
    const result = await runQualityChecks(mockDb, 'att-1', 'cand-1', 'pdf');

    expect(result.status).toBe('passed');
    expect(result.errors).toHaveLength(0);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('should return passed with no errors when candidate has no field_rules', async () => {
    const mockQuery = jest.fn();
    // Candidate query returns row without field_rules
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'cand-1', first_name: 'John', field_rules: null }],
    });
    // UPDATE attachments
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const mockDb = { query: mockQuery };
    const result = await runQualityChecks(mockDb, 'att-1', 'cand-1', 'pdf');

    expect(result.status).toBe('passed');
    expect(result.errors).toHaveLength(0);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('should return passed when all required sections are present in file', async () => {
    const mockQuery = jest.fn();
    // Candidate with requiredSections field_rules
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'cand-1',
        field_rules: { requiredSections: ['experience', 'education'] },
      }],
    });
    // Attachment file_path query
    mockQuery.mockResolvedValueOnce({
      rows: [{ file_path: '/uploads/resume.pdf' }],
    });
    // UPDATE attachments
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(
      Buffer.from('this resume contains experience and education sections', 'binary')
    );

    const mockDb = { query: mockQuery };
    const result = await runQualityChecks(mockDb, 'att-1', 'cand-1', 'pdf');

    expect(result.status).toBe('passed');
    expect(result.errors).toHaveLength(0);
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('should return failed with error when a required section is missing from file', async () => {
    const mockQuery = jest.fn();
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'cand-1',
        field_rules: { requiredSections: ['experience', 'education'] },
      }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ file_path: '/uploads/resume.pdf' }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    (fs.existsSync as jest.Mock).mockReturnValue(true);
    // File content only has 'experience', missing 'education'
    (fs.readFileSync as jest.Mock).mockReturnValue(
      Buffer.from('this resume only mentions experience here', 'binary')
    );

    const mockDb = { query: mockQuery };
    const result = await runQualityChecks(mockDb, 'att-1', 'cand-1', 'pdf');

    expect(result.status).toBe('failed');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('education');
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('should return failed when attachment file does not exist on disk', async () => {
    const mockQuery = jest.fn();
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'cand-1',
        field_rules: { requiredSections: ['experience'] },
      }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ file_path: '/uploads/missing.pdf' }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const mockDb = { query: mockQuery };
    const result = await runQualityChecks(mockDb, 'att-1', 'cand-1', 'pdf');

    expect(result.status).toBe('failed');
    expect(result.errors.some((e: string) => e.includes('Unable to read attachment file'))).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('should return failed with unsupported file type error for non-pdf/docx', async () => {
    const mockQuery = jest.fn();
    // Candidate with no field_rules so only candidate + UPDATE queries are made
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'cand-1', field_rules: null }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const mockDb = { query: mockQuery };
    const result = await runQualityChecks(mockDb, 'att-1', 'cand-1', 'png');

    expect(result.status).toBe('failed');
    expect(result.errors.some((e: string) => e.includes('Unsupported file type'))).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe('ensureUploadDir', () => {
  afterEach(() => jest.resetAllMocks());

  it('should not call mkdirSync and return path when directory already exists', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const mkdirMock = fs.mkdirSync as jest.Mock;
    mkdirMock.mockImplementation(() => undefined);

    const result = ensureUploadDir();

    expect(mkdirMock).not.toHaveBeenCalled();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should call mkdirSync with recursive option and return path when directory does not exist', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    const mkdirMock = fs.mkdirSync as jest.Mock;
    mkdirMock.mockImplementation(() => undefined);

    const result = ensureUploadDir();

    expect(mkdirMock).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
