/**
 * Violation Scanner Unit Tests
 *
 * These tests verify the rule-based violation detection logic.
 * They use a mock database pool to isolate the scanning logic.
 */

// Mock the pg Pool
const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as any;

import { scanCandidate } from '../../../backend/src/../../backend/src/services/violation-scanner';

describe('ViolationScanner', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should detect prohibited phrases in candidate data', async () => {
    // Setup: active rules
    mockQuery
      // Get active rules
      .mockResolvedValueOnce({
        rows: [{
          id: 'rule-1',
          rule_type: 'prohibited_phrase',
          rule_config: { phrases: ['illegal alien', 'handicapped'] },
          severity: 'error',
          is_active: true,
        }],
      })
      // Get candidate
      .mockResolvedValueOnce({
        rows: [{
          id: 'cand-1',
          first_name: 'John',
          last_name: 'Doe',
          email: 'john@test.com',
          eeoc_disposition: 'selected',
        }],
      })
      // Get latest resume
      .mockResolvedValueOnce({
        rows: [{
          content: { summary: 'Former illegal alien status resolved' },
        }],
      })
      // Check existing violations
      .mockResolvedValueOnce({ rows: [] })
      // Insert violation
      .mockResolvedValueOnce({ rows: [] });

    const violations = await scanCandidate(mockPool, 'cand-1');

    expect(violations.length).toBe(1);
    expect(violations[0].details.type).toBe('prohibited_phrase');
    expect(violations[0].details.phrase).toBe('illegal alien');
  });

  it('should detect missing required fields', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'rule-2',
          rule_type: 'missing_field',
          rule_config: { field: 'eeoc_disposition', message: 'EEOC disposition required' },
          severity: 'critical',
          is_active: true,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'cand-2',
          first_name: 'Jane',
          last_name: 'Smith',
          eeoc_disposition: null, // Missing!
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const violations = await scanCandidate(mockPool, 'cand-2');

    expect(violations.length).toBe(1);
    expect(violations[0].details.type).toBe('missing_field');
    expect(violations[0].details.field).toBe('eeoc_disposition');
  });

  it('should detect duplicate SSN using deterministic ssn_hash (not ciphertext)', async () => {
    // The rule references ssn_encrypted, but the scanner should use the
    // deterministic ssn_hash column for comparison (since AES-GCM ciphertext
    // is random and cannot be compared for equality).
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'rule-3',
          rule_type: 'duplicate_pattern',
          rule_config: { field: 'ssn_encrypted', message: 'Duplicate SSN' },
          severity: 'critical',
          is_active: true,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'cand-3',
          first_name: 'Bob',
          last_name: 'Jones',
          ssn_encrypted: Buffer.from('random-ciphertext'),
          ssn_hash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      // Duplicate check — should query ssn_hash, not ssn_encrypted
      .mockResolvedValueOnce({ rows: [{ id: 'cand-duplicate' }] })
      // Existing violations check
      .mockResolvedValueOnce({ rows: [] })
      // Insert
      .mockResolvedValueOnce({ rows: [] });

    const violations = await scanCandidate(mockPool, 'cand-3');

    expect(violations.length).toBe(1);
    expect(violations[0].details.type).toBe('duplicate_pattern');
    expect((violations[0].details as any).duplicateIds).toContain('cand-duplicate');

    // Verify the SQL query used ssn_hash (the deterministic column), not ssn_encrypted
    const dupeQuery = mockQuery.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('SELECT id FROM candidates')
    );
    expect(dupeQuery).toBeDefined();
    if (dupeQuery) {
      expect(dupeQuery[0]).toContain('"ssn_hash"');
      expect(dupeQuery[0]).not.toContain('"ssn_encrypted"');
    }
  });

  it('should return empty for candidate with no violations', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'rule-2',
          rule_type: 'missing_field',
          rule_config: { field: 'eeoc_disposition' },
          severity: 'critical',
          is_active: true,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'cand-clean',
          first_name: 'Clean',
          last_name: 'Candidate',
          eeoc_disposition: 'Selected', // Present!
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const violations = await scanCandidate(mockPool, 'cand-clean');
    expect(violations.length).toBe(0);
  });

  it('should return empty if candidate not found', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // rules
      .mockResolvedValueOnce({ rows: [] }); // no candidate

    const violations = await scanCandidate(mockPool, 'nonexistent');
    expect(violations.length).toBe(0);
  });

  it('should skip duplicate violations (idempotent)', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'rule-1',
          rule_type: 'prohibited_phrase',
          rule_config: { phrases: ['handicapped'] },
          severity: 'error',
          is_active: true,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'cand-1',
          first_name: 'Test',
          last_name: 'handicapped mention',
          email: '',
          eeoc_disposition: '',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      // Existing violation found
      .mockResolvedValueOnce({ rows: [{ id: 'existing-violation' }] });

    const violations = await scanCandidate(mockPool, 'cand-1');

    // Violations still detected but not re-inserted
    expect(violations.length).toBe(1);
    // The insert query should NOT have been called
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO violation_instances'),
      expect.anything()
    );
  });
});
