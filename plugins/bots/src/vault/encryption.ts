import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface Envelope {
  v: 1;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

export function seal<T>(items: T[], key: Buffer, salt: string, aad: Buffer): Envelope {
  const plaintext = Buffer.from(JSON.stringify(items));
  try {
    if (plaintext.length > 2 * 1024 * 1024) throw new Error('The Vault is full.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      v: 1,
      salt,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64')
    };
  } finally {
    plaintext.fill(0);
  }
}
export function open<T>(e: Envelope, key: Buffer, aad: Buffer): T[] {
  try {
    if (e.v !== 1 || e.data.length > 3 * 1024 * 1024) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
    const bytes = Buffer.concat([decipher.update(Buffer.from(e.data, 'base64')), decipher.final()]);
    try {
      return JSON.parse(bytes.toString('utf8')) as T[];
    } finally {
      bytes.fill(0);
    }
  } catch {
    throw new Error('Could not unlock this Vault. Check your passphrase.');
  }
}
