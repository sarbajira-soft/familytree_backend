import * as crypto from 'crypto';

const ENCRYPTION_PREFIX = 'enc:v1';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function decodeKey(rawKey: string | undefined, label: string): Buffer {
  const value = String(rawKey || '').trim();
  if (!value) {
    throw new Error(`${label} is not configured`);
  }

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }

  try {
    const base64Decoded = Buffer.from(value, 'base64');
    if (base64Decoded.length === 32) {
      return base64Decoded;
    }
  } catch {
    // Fall through to UTF-8 handling.
  }

  const utf8Decoded = Buffer.from(value, 'utf8');
  if (utf8Decoded.length === 32) {
    return utf8Decoded;
  }

  throw new Error(`${label} must decode to exactly 32 bytes`);
}

function getEncryptionKey(): Buffer {
  return decodeKey(process.env.DATA_ENCRYPTION_KEY, 'DATA_ENCRYPTION_KEY');
}

function getHashKey(): Buffer {
  const configuredHashKey = String(process.env.DATA_HASH_KEY || '').trim();
  if (configuredHashKey) {
    return decodeKey(configuredHashKey, 'DATA_HASH_KEY');
  }

  return crypto
    .createHash('sha256')
    .update(Buffer.concat([getEncryptionKey(), Buffer.from(':hash', 'utf8')]))
    .digest();
}

export function ensureFieldEncryptionConfigured(): void {
  getEncryptionKey();
  getHashKey();
}

export function isEncryptedValue(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${ENCRYPTION_PREFIX}:`);
}

export function encryptFieldValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  if (isEncryptedValue(normalized)) {
    return normalized;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    ENCRYPTION_ALGORITHM,
    getEncryptionKey(),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(normalized, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptFieldValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  if (!isEncryptedValue(normalized)) {
    return normalized;
  }

  const [, , ivBase64, authTagBase64, ciphertextBase64] = normalized.split(':');
  if (!ivBase64 || !authTagBase64 || !ciphertextBase64) {
    return normalized;
  }

  try {
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      getEncryptionKey(),
      Buffer.from(ivBase64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextBase64, 'base64')),
      decipher.final(),
    ]);

    return plaintext.toString('utf8');
  } catch {
    return normalized;
  }
}

export function normalizeEmailValue(value: unknown): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

export function normalizeMobileValue(value: unknown): string | null {
  const digits = String(value || '').replace(/\D/g, '').slice(-14);
  return digits || null;
}

export function normalizeDateValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }

  return parsed.toISOString();
}

export function buildFieldHash(value: unknown): string | null {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  return crypto
    .createHmac('sha256', getHashKey())
    .update(normalized, 'utf8')
    .digest('hex');
}

export function buildEmailHash(value: unknown): string | null {
  return buildFieldHash(normalizeEmailValue(value));
}

export function buildMobileHash(value: unknown): string | null {
  return buildFieldHash(normalizeMobileValue(value));
}
