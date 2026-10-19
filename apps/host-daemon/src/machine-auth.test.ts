import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHostAuth, writeHostAuth } from './machine-auth.js';

describe('machine auth.json', () => {
  it.each(['tunnel', 'non-tunnel', undefined] as const)('reads provenance backward compatibly: %s', provenance => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-auth-provenance-'));
    try {
      writeHostAuth(dataDir, { hostId: 'h', hostKey: 'key', hostName: 'box', provenance });
      expect(readHostAuth(dataDir)?.provenance).toBe(provenance);
      expect(statSync(join(dataDir, 'auth.json')).mode & 0o777).toBe(0o600);
      expect(readdirSync(dataDir)).toEqual(['auth.json']);
    } finally { rmSync(dataDir, { recursive: true, force: true }); }
  });
  it('treats invalid provenance as unknown and rejects incomplete or malformed credentials', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-auth-invalid-'));
    try {
      writeFileSync(join(dataDir, 'auth.json'), JSON.stringify({ hostId: 'h', hostKey: 'key', provenance: 'public' }));
      expect(readHostAuth(dataDir)?.provenance).toBeUndefined();
      for (const text of ['{}', '{"hostId":"h"}', '{"hostKey":"k"}', 'invalid']) {
        writeFileSync(join(dataDir, 'auth.json'), text); expect(readHostAuth(dataDir)).toBeNull();
      }
      expect(readFileSync(join(dataDir, 'auth.json'), 'utf8')).toBe('invalid');
    } finally { rmSync(dataDir, { recursive: true, force: true }); }
  });
  it('round-trips host credentials', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-auth-'));
    expect(readHostAuth(dataDir)).toBeNull();
    writeHostAuth(dataDir, { hostId: 'h1', hostKey: 'k'.repeat(32), hostName: 'box' });
    expect(readHostAuth(dataDir)).toEqual({
      hostId: 'h1',
      hostKey: 'k'.repeat(32),
      hostName: 'box'
    });
  });
});
