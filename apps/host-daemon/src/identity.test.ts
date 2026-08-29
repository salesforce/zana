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
});
