-- Add deterministic hash column for duplicate SSN detection.
-- AES-GCM uses random IVs so ciphertext comparison cannot detect duplicates.
-- This keyed HMAC-SHA256 hash is deterministic: same plaintext -> same hash.
-- The hash is NOT reversible to the plaintext.

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS ssn_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_cand_ssn_hash ON candidates(ssn_hash)
  WHERE ssn_hash IS NOT NULL;
