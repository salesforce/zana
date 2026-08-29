import { describe, expect, it } from 'vitest';
import { decodeRoutePath } from '../../lib/decode-route.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('useRouteState', () => {
  it('is a thin wrapper around decodeRoutePath', () => {
    const source = readFileSync(fileURLToPath(new URL('../useRouteState.ts', import.meta.url)), 'utf8');
    expect(source).toMatch(/decodeRoutePath\(location\.pathname, location\.hash\)/);
    expect(decodeRoutePath('/settings/agents', '#overseer').settingsTab).toBe('agents');
    expect(decodeRoutePath('/settings/agents', '#overseer').settingsAnchor).toBe('overseer');
  });
});
