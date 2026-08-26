import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHostAuth, writeHostAuth } from './machine-auth.js';

describe('machine auth.json', () => {
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
