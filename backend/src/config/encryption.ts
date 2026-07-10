import * as crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits

let masterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (masterKey) return masterKey;

  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error('ENCRYPTION_KEY not set in environment. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }

  if (keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }

  masterKey = Buffer.from(keyHex, 'hex');
  return masterKey;
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 * Returns base64 encoded: iv:ciphertext:tag
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Combine: iv + ciphertext + tag
  const combined = Buffer.concat([iv, ciphertext, tag]);
  return combined.toString('base64');
}

/**
 * Decrypt a base64 encoded string (iv:ciphertext:tag)
 */
export function decrypt(encrypted: string): string {
  const key = getMasterKey();
  const combined = Buffer.from(encrypted, 'base64');

  if (combined.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid encrypted data: too short');
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(-TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH, -TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Mask a credential for display (show only last 4 chars)
 */
export function maskCredential(value: string): string {
  if (!value) return '••••';
  if (value.length <= 8) return '••••••••';
  return '••••••••' + value.slice(-4);
}

/**
 * Validate encryption key format
 */
export function validateEncryptionKey(): boolean {
  try {
    getMasterKey();
    return true;
  } catch {
    return false;
  }
}