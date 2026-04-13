import { encryptField, decryptField, maskField } from './encryption.service';

describe('EncryptionService', () => {
  describe('encryptField / decryptField', () => {
    it('should encrypt and decrypt a string correctly', () => {
      const plaintext = '123-45-6789';
      const encrypted = encryptField(plaintext);

      expect(encrypted).toBeInstanceOf(Buffer);
      expect(encrypted.length).toBeGreaterThan(plaintext.length);

      const decrypted = decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertexts for same plaintext (random IV)', () => {
      const plaintext = 'test-value';
      const encrypted1 = encryptField(plaintext);
      const encrypted2 = encryptField(plaintext);

      expect(encrypted1).not.toEqual(encrypted2);

      // But both decrypt to the same value
      expect(decryptField(encrypted1)).toBe(plaintext);
      expect(decryptField(encrypted2)).toBe(plaintext);
    });

    it('should handle empty strings', () => {
      const encrypted = encryptField('');
      const decrypted = decryptField(encrypted);
      expect(decrypted).toBe('');
    });

    it('should handle unicode characters', () => {
      const plaintext = '日本語テスト 🎉';
      const encrypted = encryptField(plaintext);
      const decrypted = decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle long strings', () => {
      const plaintext = 'A'.repeat(10000);
      const encrypted = encryptField(plaintext);
      const decrypted = decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should throw on tampered data', () => {
      const encrypted = encryptField('sensitive');
      // Tamper with the ciphertext
      encrypted[encrypted.length - 1] ^= 0xff;
      expect(() => decryptField(encrypted)).toThrow();
    });
  });

  describe('maskField', () => {
    it('should mask SSN showing last 4 characters', () => {
      expect(maskField('123-45-6789')).toBe('*******6789');
    });

    it('should mask short values completely', () => {
      expect(maskField('ab', 4)).toBe('****');
    });

    it('should handle exact length', () => {
      expect(maskField('abcd', 4)).toBe('abcd');
    });

    it('should default to showing last 4 characters', () => {
      expect(maskField('1234567890')).toBe('******7890');
    });

    it('should handle custom visible chars', () => {
      expect(maskField('1234567890', 2)).toBe('********90');
    });
  });
});
