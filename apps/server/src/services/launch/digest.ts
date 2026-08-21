import { createHash } from 'node:crypto';

const EXCLUDED_ENVELOPE_KEYS = new Set([
  'authorizationId', 'ledgerId', 'idempotencyKey', 'createdAt', 'updatedAt', 'consumedAt', 'revokedAt'
]);

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

function digestPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(digestPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !EXCLUDED_ENVELOPE_KEYS.has(key))
    .map(([key, nested]) => [key, digestPayload(nested)]));
}

export function launchDigest(value: unknown): string {
  return `launch-v1:${createHash('sha256').update(canonicalJson(digestPayload(value))).digest('hex')}`;
}

export function taskDigest(task: string | Uint8Array): string {
  const bytes = typeof task === 'string' ? Buffer.from(task, 'utf8') : Buffer.from(task);
  return launchDigest({ initialTaskBytes: bytes.toString('base64') });
}
