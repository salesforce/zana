import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fakeHome = mkdtempSync(join(tmpdir(), 'persona-mcp-rollback-'));
vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>();
  return { ...actual, homedir: () => fakeHome };
});
vi.mock('electron', () => ({
  app: { getPath: (name: string) => { if (name === 'home') return fakeHome; throw new Error(`Unexpected getPath('${name}')`); } },
  shell: { openPath: vi.fn() }
}));

import { sanitizePersona } from '../persona-store.js';

let mod: typeof import('@zana-ai/zcc-host-daemon/mcp-config');

beforeAll(async () => {
  mod = await import('@zana-ai/zcc-host-daemon/mcp-config');
  const mk = (id: string) => ({
    id,
    enabled: true,
    rootDir: fakeHome,
    mcpServers: [
      { name: 'auto', type: 'stdio', command: 'node', alwaysOn: true },
      { name: 'manual', type: 'http', url: 'https://example.test/mcp' }
    ]
  });
  mod.rebuildPluginServers([mk('p1')]);
});
afterAll(() => {
  mod.rebuildPluginServers([]);
  rmSync(fakeHome, { recursive: true, force: true });
});

/**
 * The code path before the allowlist change (host-daemon `selectedServerEntries`
 * at 4da9d47a): the persona list was ADDITIVE, `names = extras U alwaysOn`, each
 * resolved against the registry; unknown names ignored.
 */
function previousSelection(registryKeys: string[], alwaysOn: string[], extras?: string[]): string[] {
  const names = new Set([...(extras ?? []), ...alwaysOn]);
  return [...names].filter((n) => registryKeys.includes(n)).sort();
}

const REGISTRY = ['plugin:p1:auto', 'plugin:p1:manual'];
const ALWAYS_ON = ['plugin:p1:auto'];
const names = (list?: string[]) => mod.sessionPluginMcpServers(list).map((s) => s.name).sort();
const KEY = (n: string) => n.replace(/[^A-Za-z0-9_-]/g, '_');

describe('rollback: stored allowlist read by the previous (additive) code', () => {
  it('a list written under the new semantics survives the old sanitizer path unchanged (no data loss on rollback)', () => {
    const stored = sanitizePersona({ id: 'r', name: 'R', mcpServers: ['plugin:p1:manual', 'zana'] })!;
    // Old code read the same string array; re-sanitizing is stable (idempotent).
    expect(sanitizePersona(JSON.parse(JSON.stringify(stored)))!.mcpServers).toEqual(['plugin:p1:manual', 'zana']);
  });

  it('old path adds servers rather than removing them: a restricted persona regains the always-on base', () => {
    const list = ['plugin:p1:manual'];
    // new: exactly the listed server
    expect(names(list)).toEqual([KEY('plugin:p1:manual')]);
    // old: listed server PLUS the always-on base the new code excluded
    const old = previousSelection(REGISTRY, ALWAYS_ON, list).map(KEY);
    expect(old).toEqual([KEY('plugin:p1:auto'), KEY('plugin:p1:manual')]);
    expect(old).toEqual(expect.arrayContaining(names(list)));
    expect(old.length).toBeGreaterThan(names(list).length);
  });

  it('old path ignores [] (adds nothing) while new code selects none: rollback widens, never narrows', () => {
    expect(names([])).toEqual([]);
    expect(previousSelection(REGISTRY, ALWAYS_ON, []).map(KEY)).toEqual([KEY('plugin:p1:auto')]);
  });

  it('absent value is identical on both paths (unchanged for personas without the field)', () => {
    expect(names(undefined)).toEqual(previousSelection(REGISTRY, ALWAYS_ON, undefined).map(KEY));
  });

  it('for every list, old selection is a superset of the new one (rollback never removes a server)', () => {
    for (const list of [[], ['plugin:p1:manual'], ['plugin:p1:auto'], ['zana'], ['plugin:p1:manual', 'plugin:p1:auto']]) {
      const oldSel = previousSelection(REGISTRY, ALWAYS_ON, list).map(KEY);
      for (const n of names(list)) expect(oldSel).toContain(n);
    }
  });
});
