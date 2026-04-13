import * as crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = config.encryption.masterKey;
  return crypto.createHash('sha256').update(key).digest();
}

export function encryptField(plaintext: string): Buffer {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Format: IV (12 bytes) + AuthTag (16 bytes) + Ciphertext
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptField(data: Buffer): string {
  const key = getKey();

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted) + decipher.final('utf8');
}

export function maskField(value: string, visibleChars: number = 4): string {
  if (value.length <= visibleChars) return '****';
  return '*'.repeat(value.length - visibleChars) + value.slice(-visibleChars);
}
