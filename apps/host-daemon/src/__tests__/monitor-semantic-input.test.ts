import { describe, expect, it } from 'vitest';
import { serializeMonitorTranscript } from '../monitor-semantic-input.js';

describe('serializeMonitorTranscript', () => {
  it('redacts common credentials and secret-bearing URL values', () => {
    const result = serializeMonitorTranscript(
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz\napi_key=super-secret\nhttps://x.invalid/?token=abc123456789'
    );

    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(result).not.toContain('super-secret');
    expect(result).not.toContain('abc123456789');
    expect(result).toContain('[redacted]');
  });

  it('redacts common cloud, source-control, JWT, and private-key credentials', () => {
    const result = serializeMonitorTranscript(
      'AKIA1234567890ABCDEF ghp_abcdefghijklmnopqrstuvwxyz123456 eyJabcdefghijk.abcdefghijk.abcdefghijk\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----'
    );
    expect(result).not.toContain('AKIA1234567890ABCDEF');
    expect(result).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(result).not.toContain('-----BEGIN PRIVATE KEY-----');
  });

  it('caps UTF-8 text without splitting Unicode', () => {
    const result = serializeMonitorTranscript('x'.repeat(6140) + '😀'.repeat(100));

    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(6 * 1024);
    expect(result.endsWith('[truncated]')).toBe(true);
  });
});
