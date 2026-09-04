import crypto from 'crypto';

/**
 * AES-256-GCM encryption for third-party OAuth tokens at rest.
 *
 * These tokens are credentials to a learner's earning account on an external
 * platform. A database dump must not yield usable tokens, so they are stored
 * encrypted with a key held only in the environment.
 *
 * Format: base64( iv[12] || authTag[16] || ciphertext )
 */

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32'
    );
  }

  // Accept a 64-char hex key (32 bytes). Anything else is a configuration error
  // rather than something to silently pad or truncate.
  const key = Buffer.from(raw.trim(), 'hex');
  if (key.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be 32 bytes as 64 hex chars (got ${key.length} bytes)`
    );
  }

  cachedKey = key;
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Ciphertext is too short to be valid');
  }

  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Test helper: clears the memoised key so a changed env var takes effect. */
export function resetKeyCache(): void {
  cachedKey = null;
}
