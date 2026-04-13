/**
 * Security-focused behavior tests covering:
 * - Deterministic hash for duplicate SSN detection
 * - Approval write-back field whitelisting via approval-engine behavior
 */

import { encryptField, decryptField, deterministicHash } from './encryption.service';

describe('Deterministic SSN Hash', () => {
  it('should produce the same hash for the same plaintext', () => {
    const hash1 = deterministicHash('123-45-6789');
    const hash2 = deterministicHash('123-45-6789');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it('should produce different hashes for different plaintexts', () => {
    const hash1 = deterministicHash('123-45-6789');
    const hash2 = deterministicHash('987-65-4321');
    expect(hash1).not.toBe(hash2);
  });

  it('should not match the encrypted ciphertext (not reversible)', () => {
    const plaintext = '123-45-6789';
    const hash = deterministicHash(plaintext);
    const encrypted = encryptField(plaintext);
    expect(hash).not.toBe(encrypted.toString('hex'));
  });

  it('should produce consistent hashes across encrypt cycles', () => {
    const plaintext = '555-12-3456';
    const enc1 = encryptField(plaintext);
    const enc2 = encryptField(plaintext);
    // Ciphertexts differ (random IV)
    expect(enc1.toString('hex')).not.toBe(enc2.toString('hex'));
    // But hashes are identical
    const hash1 = deterministicHash(plaintext);
    const hash2 = deterministicHash(plaintext);
    expect(hash1).toBe(hash2);
  });
});

describe('Approval Write-Back Field Whitelist (behavior)', () => {
  const mockQuery = jest.fn();
  const mockDb = { query: mockQuery } as any;

  jest.mock('./audit.service', () => ({
    createAuditEntry: jest.fn().mockResolvedValue(undefined),
  }));
  jest.mock('./notification.service', () => ({
    createNotification: jest.fn().mockResolvedValue('notif-id'),
  }));

  const { processApprovalDecision } = require('./approval-engine');

  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should apply only whitelisted fields from final_write_back on approval', async () => {
    // Setup: step with a write-back containing both allowed and disallowed fields
    const writeBack = {
      status: 'approved',
      password_hash: 'injected',   // disallowed — should be excluded
      ssn_encrypted: 'stolen',     // disallowed — should be excluded
    };

    mockQuery
      // 1. Step lookup
      .mockResolvedValueOnce({
        rows: [{
          id: 'step-1',
          request_id: 'req-1',
          approver_id: 'user-1',
          status: 'pending',
          approval_mode: 'any',
          request_status: 'pending',
          entity_type: 'candidate',
          entity_id: 'cand-1',
          final_write_back: writeBack,
          requested_by: 'requester-1',
        }],
      })
      // 2. Update step
      .mockResolvedValueOnce({ rowCount: 1 })
      // 3+. Remaining queries (audit, request update, write-back, etc.)
      .mockResolvedValue({ rowCount: 1, rows: [{ id: 'notif-1' }] });

    const result = await processApprovalDecision(
      mockDb, 'req-1', 'step-1', 'user-1', 'approved', 'Approved'
    );

    expect(result.requestStatus).toBe('approved');
    expect(result.completed).toBe(true);

    // Verify write-back SQL only updates the allowed 'status' field
    const writeBackCall = mockQuery.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('UPDATE "candidates"')
    );
    expect(writeBackCall).toBeDefined();
    // Should contain "status" column update
    expect(writeBackCall![0]).toContain('"status"');
    // Should NOT contain disallowed fields
    expect(writeBackCall![0]).not.toContain('password_hash');
    expect(writeBackCall![0]).not.toContain('ssn_encrypted');
    // Values should only include the approved status, not the injected values
    expect(writeBackCall![1]).toContain('approved');
    expect(writeBackCall![1]).not.toContain('injected');
    expect(writeBackCall![1]).not.toContain('stolen');
  });

  it('should skip write-back entirely when all fields are disallowed', async () => {
    const writeBack = {
      password_hash: 'injected',
      dob_encrypted: 'stolen',
    };

    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'step-1',
          request_id: 'req-1',
          approver_id: 'user-1',
          status: 'pending',
          approval_mode: 'any',
          request_status: 'pending',
          entity_type: 'candidate',
          entity_id: 'cand-1',
          final_write_back: writeBack,
          requested_by: 'requester-1',
        }],
      })
      .mockResolvedValue({ rowCount: 1, rows: [{ id: 'notif-1' }] });

    const result = await processApprovalDecision(
      mockDb, 'req-1', 'step-1', 'user-1', 'approved', 'OK'
    );

    expect(result.requestStatus).toBe('approved');

    // Should NOT have an UPDATE "candidates" call since all fields were rejected
    const writeBackCall = mockQuery.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('UPDATE "candidates" SET')
    );
    expect(writeBackCall).toBeUndefined();
  });
});
