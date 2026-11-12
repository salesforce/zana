import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testHome = join(tmpdir(), `persona-mcp-legacy-${process.pid}-${Date.now()}`);
vi.mock('electron', () => ({
  app: { getPath: (name: string) => { if (name === 'home') return testHome; throw new Error(`Unexpected getPath('${name}')`); } },
  shell: { openPath: vi.fn() }
}));

import { effectiveMcpServers, PERSONA_MCP_NAME_MAX, PERSONA_MCP_SERVERS_MAX, type Persona } from '@zana-ai/zcc-domain/product';
import { PersonaStore, sanitizePersona } from '../persona-store.js';

const userDir = join(testHome, '.zcc', 'personas');
const base = { id: 'legacy', name: 'Legacy' };

/** Load a persona file exactly as an older version would have persisted it. */
function loadFromDisk(body: Record<string, unknown>): Persona {
  mkdirSync(userDir, { recursive: true });
  writeFileSync(join(userDir, `${String(body.id)}.json`), JSON.stringify(body));
  const store = new PersonaStore(() => []);
  store.refresh();
  const found = store.list().find((p) => p.id === body.id);
  expect(found, 'persona must survive load (lossless store)').toBeDefined();
  return found!;
}

beforeEach(() => {
  rmSync(testHome, { recursive: true, force: true });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(testHome, { recursive: true, force: true });
});

describe('legacy persisted mcpServers values (D1: reuse field, exclusive allowlist)', () => {
  it('absent = all: stays undefined and resolves to unrestricted (unchanged behaviour)', () => {
    const p = loadFromDisk({ ...base });
    expect(p.mcpServers).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(p, 'mcpServers') ? p.mcpServers : undefined).toBeUndefined();
    expect(effectiveMcpServers(undefined, p)).toBeUndefined();
  });

  it('[] = none beyond zcc-inbox (was: add nothing)', () => {
    const p = loadFromDisk({ ...base, mcpServers: [] });
    expect(p.mcpServers).toEqual([]);
    expect(effectiveMcpServers(undefined, p)).toEqual(['zcc-inbox']);
  });

  it('["zana"] is now an exclusive allowlist: exactly zana plus zcc-inbox (was: base servers plus zana)', () => {
    const p = loadFromDisk({ ...base, mcpServers: ['zana'] });
    expect(p.mcpServers).toEqual(['zana']);
    expect(effectiveMcpServers(undefined, p)).toEqual(['zcc-inbox', 'zana']);
  });

  it('glob and over-long entries are filtered with a warning, persona kept, list stays exclusive', () => {
    const p = loadFromDisk({ ...base, mcpServers: ['zana', 'git*', 'x'.repeat(PERSONA_MCP_NAME_MAX + 1)] });
    expect(p.mcpServers).toEqual(['zana']);
    expect(effectiveMcpServers(undefined, p)).toEqual(['zcc-inbox', 'zana']);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('dropped 2 invalid mcpServers entries'));
  });

  it('all-invalid legacy list fails closed to [] (zcc-inbox only), never to unrestricted', () => {
    const p = loadFromDisk({ ...base, mcpServers: ['*', '?'] });
    expect(p.mcpServers).toEqual([]);
    expect(effectiveMcpServers(undefined, p)).toEqual(['zcc-inbox']);
  });

  it('more than 63 entries are truncated to the cap with a warning; zcc-inbox still fits', () => {
    const many = Array.from({ length: PERSONA_MCP_SERVERS_MAX + 7 }, (_, i) => `srv${i}`);
    const p = loadFromDisk({ ...base, mcpServers: many });
    expect(p.mcpServers).toEqual(many.slice(0, PERSONA_MCP_SERVERS_MAX));
    expect(effectiveMcpServers(undefined, p)).toHaveLength(PERSONA_MCP_SERVERS_MAX + 1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('truncated'));
  });

  it('a malformed non-array value is treated as absent (all), persona kept, with a warning', () => {
    const p = loadFromDisk({ ...base, mcpServers: 'zana' });
    expect(p.mcpServers).toBeUndefined();
    expect(effectiveMcpServers(undefined, p)).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('non-array'));
  });

  it('absent and [] stay distinguishable through sanitize, and a lean-workers team does not preset a list', () => {
    expect(sanitizePersona(base)!.mcpServers).toBeUndefined();
    expect(sanitizePersona({ ...base, mcpServers: [] })!.mcpServers).toEqual([]);
    expect(effectiveMcpServers({ leanWorkers: true }, sanitizePersona(base)!, 'worker')).toBeUndefined();
  });

  it('no built-in persona carries mcpServers (audit: all remain unrestricted)', () => {
    const store = new PersonaStore(() => []);
    store.refresh();
    const builtins = store.list().filter((p) => p.source === 'builtin');
    expect(builtins.length).toBeGreaterThan(3);
    for (const p of builtins) expect(p.mcpServers, p.id).toBeUndefined();
  });
});
