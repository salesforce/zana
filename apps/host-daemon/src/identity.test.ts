import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { persistHostId, readPersistedHostId, resolveHostId } from './identity.js';

describe('host identity', () => {
  it('does not persist a host id until enroll succeeds', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-host-id-'));
    const resolved = resolveHostId(dataDir);
    expect(readPersistedHostId(dataDir)).toBeNull();
    persistHostId(dataDir, resolved);
    expect(readFileSync(join(dataDir, 'host.id'), 'utf8').trim()).toBe(resolved);
    expect(resolveHostId(dataDir)).toBe(resolved);
  });

  it('is idempotent when the same host id is already on disk', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-host-id-'));
    persistHostId(dataDir, '11111111-1111-4111-8111-111111111111');
    persistHostId(dataDir, '11111111-1111-4111-8111-111111111111');
    expect(readPersistedHostId(dataDir)).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('replaces a leftover host id after a re-join with a new minted id', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-host-id-'));
    persistHostId(dataDir, '11111111-1111-4111-8111-111111111111');
    persistHostId(dataDir, '22222222-2222-4222-8222-222222222222');
    expect(readPersistedHostId(dataDir)).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('rejects a configured host id that disagrees with the file before enroll', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-host-id-'));
    persistHostId(dataDir, '11111111-1111-4111-8111-111111111111');
    expect(() => resolveHostId(dataDir, '22222222-2222-4222-8222-222222222222')).toThrow(
      /Configured host id/
    );
  });
});
