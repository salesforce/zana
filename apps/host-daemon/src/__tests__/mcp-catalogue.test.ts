import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HostMcpCatalogueResultSchema, HostRpcCommandSchema } from '@zana-ai/zcc-contracts/host-rpc';
import { buildMcpCatalogue, buildMcpCatalogueWithNotes, MAX_CATALOGUE_ENTRIES } from '../mcp-catalogue.js';
import { rebuildExtensionServers, rebuildPluginServers } from '../mcp-config.js';

let dir: string;
let project: string;
const env = () => ({ CLAUDE_CONFIG_DIR: dir }) as NodeJS.ProcessEnv;
const writeUser = (mcpServers: unknown) => writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-cat-'));
  project = mkdtempSync(join(tmpdir(), 'mcp-cat-proj-'));
  rebuildPluginServers([]);
  rebuildExtensionServers([]);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  rebuildPluginServers([]);
  rebuildExtensionServers([]);
});

describe('buildMcpCatalogue', () => {
  it('lists user servers with availability from CLAUDE_CONFIG_DIR', () => {
    writeUser({ good: { command: 'c' }, remote: { url: 'https://h.example/mcp' } });
    expect(buildMcpCatalogue({ env: env() })).toEqual([
      { key: 'good', source: 'user', available: true },
      { key: 'remote', source: 'user', available: true }
    ]);
  });

  it('marks a credential-stripped server unavailable and a dropped one not-carried', () => {
    writeUser({
      stripped: { command: 'c', env: { TOKEN: 'secret' } },
      emptyEnv: { command: 'c', env: {} },
      leaky: { command: 'c', args: ['--api-key', 'x'] }
    });
    expect(buildMcpCatalogue({ env: env() })).toEqual([
      { key: 'stripped', source: 'user', available: false, reason: 'credentials-stripped' },
      { key: 'emptyEnv', source: 'user', available: true },
      { key: 'leaky', source: 'user', available: false, reason: 'not-carried' }
    ]);
  });

  it('never emits command, args, env, headers, oauth or url values (Rule 1)', () => {
    writeUser({
      a: { command: 'SECRETCMD', args: ['ARGVAL'], env: { K: 'ENVVAL' }, headers: { H: 'HDRVAL' }, oauth: { t: 'OAUTHVAL' } },
      b: { url: 'https://URLHOST.example/p', auth: 'AUTHVAL' }
    });
    const out = JSON.stringify(buildMcpCatalogueWithNotes({ env: env() }));
    for (const leak of ['SECRETCMD', 'ARGVAL', 'ENVVAL', 'HDRVAL', 'OAUTHVAL', 'URLHOST', 'AUTHVAL']) {
      expect(out).not.toContain(leak);
    }
    for (const entry of buildMcpCatalogue({ env: env() })) {
      expect(Object.keys(entry).sort()).toEqual(expect.arrayContaining(['available', 'key', 'source']));
      expect(Object.keys(entry).every((k) => ['available', 'key', 'reason', 'source'].includes(k))).toBe(true);
    }
  });

  it('ignores a user server named with a plugin:/ext: prefix and notes it (AC-14b)', () => {
    writeUser({ 'plugin:evil:x': { command: 'c' }, 'ext:evil:y': { command: 'c' }, ok: { command: 'c' } });
    const { entries, notes } = buildMcpCatalogueWithNotes({ env: env() });
    expect(entries).toEqual([{ key: 'ok', source: 'user', available: true }]);
    expect(notes).toHaveLength(2);
    expect(notes.join('\n')).toMatch(/plugin:evil:x.*reserved/);
    expect(notes.join('\n')).toMatch(/ext:evil:y.*reserved/);
  });

  it('lists registry plugin and extension servers; registry entries win key collisions', () => {
    rebuildPluginServers([{ id: 'p1', enabled: true, rootDir: project, mcpServers: [{ name: 'srv', type: 'streamable-http', url: 'https://u.example' }] }]);
    rebuildExtensionServers([{ id: 'e1', enabled: true, consented: true,
      manifest: { permissions: ['agent:contribute'], mcpServers: [{ name: 'srv', type: 'streamable-http', url: 'https://u.example' }] } }]);
    writeUser({ 'plugin:p1:srv': { command: 'spoof' }, mine: { command: 'c' } });
    const { entries } = buildMcpCatalogueWithNotes({ env: env() });
    expect(entries.map((e) => `${e.source}:${e.key}`).sort()).toEqual([
      'extension:ext:e1:srv',
      'plugin:plugin:p1:srv',
      'user:mine'
    ]);
    expect(entries.filter((e) => e.key === 'plugin:p1:srv')).toHaveLength(1);
    expect(entries.find((e) => e.key === 'plugin:p1:srv')!.source).toBe('plugin');
  });

  it('lists a name defined in both user and project scope once (user first)', () => {
    writeUser({ dup: { command: 'c' } });
    writeFileSync(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { dup: { command: 'd' }, only: { command: 'c' } } }));
    const entries = buildMcpCatalogue({ env: env(), projectRoot: project });
    expect(entries.map((e) => `${e.source}:${e.key}`)).toEqual(['user:dup', 'project:only']);
  });

  it('reads project servers only for a supplied projectRoot', () => {
    writeFileSync(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { p: { command: 'c' }, 'ext:a:b': { command: 'c' } } }));
    expect(buildMcpCatalogue({ env: env() })).toEqual([]);
    const withProject = buildMcpCatalogueWithNotes({ env: env(), projectRoot: project });
    expect(withProject.entries).toEqual([{ key: 'p', source: 'project', available: true }]);
    expect(withProject.notes[0]).toMatch(/reserved/);
  });

  it('survives __proto__ names without polluting prototypes', () => {
    writeFileSync(join(dir, '.claude.json'), '{"mcpServers":{"__proto__":{"command":"c"},"x":{"command":"c"}}}');
    const entries = buildMcpCatalogue({ env: env() });
    expect(entries.map((e) => e.key).sort()).toEqual(['__proto__', 'x']);
    expect(({} as Record<string, unknown>).command).toBeUndefined();
  });

  it('notes an unreadable project .mcp.json and still lists user servers', () => {
    writeUser({ mine: { command: 'c' } });
    writeFileSync(join(project, '.mcp.json'), '{not json');
    const r = buildMcpCatalogueWithNotes({ env: env(), projectRoot: project });
    expect(r.entries).toEqual([{ key: 'mine', source: 'user', available: true }]);
    expect(r.notes.join('\n')).toMatch(/project \.mcp\.json is unreadable/);
  });

  it('notes and returns nothing for malformed config', () => {
    writeFileSync(join(dir, '.claude.json'), '{not json');
    const r = buildMcpCatalogueWithNotes({ env: env() });
    expect(r.entries).toEqual([]);
    expect(r.notes[0]).toMatch(/unreadable/);
  });

  it('rejects an oversized config (Rule 5)', () => {
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { a: { command: 'c' } }, pad: 'x'.repeat(16 * 1024 * 1024) }));
    const r = buildMcpCatalogueWithNotes({ env: env() });
    expect(r.entries).toEqual([]);
    expect(r.notes[0]).toMatch(/oversized/);
  });

  it('is silent when no config exists, and notes a non-object mcpServers', () => {
    expect(buildMcpCatalogueWithNotes({ env: env() })).toEqual({ entries: [], notes: [] });
    writeUser(['a']);
    expect(buildMcpCatalogueWithNotes({ env: env() }).notes[0]).toMatch(/not an object/);
    writeFileSync(join(dir, '.claude.json'), '[]');
    expect(buildMcpCatalogueWithNotes({ env: env() }).notes[0]).toMatch(/unreadable/);
  });

  it('caps user entries at 64 with a note and neutralises control characters in notes', () => {
    writeUser(Object.fromEntries([
      ...Array.from({ length: 80 }, (_, i) => [`s${i}`, { command: 'c' }]),
      ['ext:bad\nname', { command: 'c' }]
    ]));
    const r = buildMcpCatalogueWithNotes({ env: env() });
    expect(r.entries.length).toBeLessThanOrEqual(MAX_CATALOGUE_ENTRIES);
    expect(r.entries.filter((e) => e.source === 'user')).toHaveLength(64);
    expect(r.notes.some((n) => /omitted/.test(n))).toBe(true);
  });

  it('control characters never reach notes', () => {
    writeUser({ 'plugin:a\u0007b': { command: 'c' } });
    const note = buildMcpCatalogueWithNotes({ env: env() }).notes[0]!;
    expect(note).not.toMatch(/[\u0000-\u001f]/);
  });

  it('skips empty and over-long names', () => {
    writeUser({ '': { command: 'c' }, ['n'.repeat(129)]: { command: 'c' }, ok: { command: 'c' } });
    expect(buildMcpCatalogue({ env: env() }).map((e) => e.key)).toEqual(['ok']);
  });

  it('result and command satisfy the host-rpc contract; renderer-supplied fields are rejected (Rules 1, 2)', () => {
    writeUser({ a: { command: 'c' } });
    expect(HostMcpCatalogueResultSchema.safeParse(buildMcpCatalogueWithNotes({ env: env() })).success).toBe(true);
    expect(HostRpcCommandSchema.safeParse({ type: 'host.mcp_catalogue' }).success).toBe(true);
    expect(HostRpcCommandSchema.safeParse({ type: 'host.mcp_catalogue', projectRoot: '/etc' }).success).toBe(false);
    expect(HostRpcCommandSchema.safeParse({ type: 'host.mcp_catalogue', names: ['x'] }).success).toBe(false);
    expect(HostMcpCatalogueResultSchema.safeParse({ entries: [{ key: 'a', source: 'user', available: true, command: 'x' }], notes: [] }).success).toBe(false);
  });

  it('defaults to process.env and ~ when no options are given', () => {
    const saved = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = dir;
    try {
      writeUser({ viaProcessEnv: { command: 'c' } });
      expect(buildMcpCatalogue().map((e) => e.key)).toEqual(['viaProcessEnv']);
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = saved;
    }
  });
});
