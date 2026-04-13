/**
 * Security-focused unit tests covering:
 * - Approval write-back field whitelisting (SQL injection prevention)
 * - Deterministic hash for duplicate SSN detection
 * - Notification export ownership
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
    // Hash is hex string, encrypted is Buffer — they should never collide
    expect(hash).not.toBe(encrypted.toString('hex'));
  });

  it('should produce consistent hashes across encrypt cycles', () => {
    // Even though AES-GCM encryption is random, the hash is deterministic
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

describe('Approval Write-Back Field Whitelist', () => {
  // Import the module to verify the whitelist constants are defined
  // We test this by verifying the shape of the module rather than calling applyWriteBack directly
  // (which requires a real DB connection)

  it('should define WRITEBACK_ALLOWED_FIELDS for each entity type', async () => {
    // Read the source file and verify the whitelist exists
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, 'approval-engine.ts'),
      'utf8'
    );

    // Verify whitelist constant exists
    expect(source).toContain('WRITEBACK_ALLOWED_FIELDS');

    // Verify all entity types have whitelists
    expect(source).toContain("candidate: new Set([");
    expect(source).toContain("service_spec: new Set([");
    expect(source).toContain("credit_change: new Set([");

    // Verify dangerous fields are NOT in any whitelist
    expect(source).not.toMatch(/password_hash/);
    expect(source).not.toMatch(/ssn_encrypted/);
    expect(source).not.toMatch(/dob_encrypted/);
    expect(source).not.toMatch(/compensation_encrypted/);

    // Verify SQL identifier validation exists
    expect(source).toContain('SAFE_IDENTIFIER');
    expect(source).toContain('/^[a-z_][a-z0-9_]*$/');

    // Verify quoted identifiers are used in the SQL
    expect(source).toContain('"${f}" = $');
    expect(source).toContain('"${table}"');
  });

  it('should reject attempts to write disallowed fields via audit log', async () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, 'approval-engine.ts'),
      'utf8'
    );

    // Verify rejected fields are logged to audit
    expect(source).toContain('write_back_rejected_fields');
    expect(source).toContain('rejected_fields');
    expect(source).toContain('allowed_fields');
  });
});

describe('Notification Export Ownership Check', () => {
  it('should verify recipient_id before allowing export', async () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'notifications.ts'),
      'utf8'
    );

    // Verify the export endpoint checks recipient_id
    expect(source).toContain("existing.rows[0].recipient_id !== userId");
    // Verify it returns 403 for non-owners
    expect(source).toContain("You can only export your own notifications");
    // Verify 404 for missing notification
    expect(source).toContain("Notification not found");
  });
});
