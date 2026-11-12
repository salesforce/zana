import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fakeHome = mkdtempSync(join(tmpdir(), 'cc-mcp-allow-'));
vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>();
  return { ...actual, homedir: () => fakeHome };
});

let mod: typeof import('../mcp-config.js');

beforeAll(async () => {
  mod = await import('../mcp-config.js');
});
afterAll(() => {
  mod.rebuildPluginServers([]);
  mod.rebuildExtensionServers([]);
  rmSync(fakeHome, { recursive: true, force: true });
});

const plugin = (id: string) => ({
  id,
  enabled: true,
  rootDir: fakeHome,
  mcpServers: [
    { name: 'auto', type: 'stdio', command: 'node', alwaysOn: true },
    { name: 'manual', type: 'http', url: 'https://example.test/mcp' }
  ]
});
const ext = (id: string) => ({
  id,
  enabled: true,
  consented: true,
  manifest: { permissions: ['agent:contribute'], mcpServers: [{ name: 'manual', type: 'http', url: 'https://e.test/mcp' }] }
});

const sessionNames = (list?: string[]) => mod.sessionPluginMcpServers(list).map((s) => s.name).sort();
const bodyKeys = (path: string) =>
  Object.keys(JSON.parse(readFileSync(path, 'utf8')).mcpServers as object).filter((k) => k !== 'zcc-inbox').sort();

beforeEach(() => {
  mod.rebuildPluginServers([plugin('p1'), plugin('p2')]);
  mod.rebuildExtensionServers([ext('e1')]);
});

describe('selection modes', () => {
  it('absent list = all mode: every alwaysOn server, nothing else', () => {
    expect(sessionNames()).toEqual(['plugin_p1_auto', 'plugin_p2_auto']);
  });

  it('empty list = none (alwaysOn plugin servers are NOT exempt)', () => {
    expect(sessionNames([])).toEqual([]);
    expect(mod.alwaysOnPluginMcpAllowlist([])).toEqual([]);
    const path = mod.ensureMcpConfigForProjectSync('proj-empty', []);
    expect(bodyKeys(path)).toEqual([]);
    expect(JSON.parse(readFileSync(path, 'utf8')).mcpServers['zcc-inbox']).toBeDefined();
  });

  it('list selects exactly the matched servers, dropping unnamed alwaysOn ones', () => {
    expect(sessionNames(['plugin:p1:manual'])).toEqual(['plugin_p1_manual']);
  });

  it('bare name covers plugin and extension servers of that name', () => {
    expect(sessionNames(['manual'])).toEqual(['ext_e1_manual', 'plugin_p1_manual', 'plugin_p2_manual']);
  });

  it('pinned keys cover only their own source', () => {
    expect(sessionNames(['ext:e1:manual'])).toEqual(['ext_e1_manual']);
    expect(sessionNames(['plugin:e1:manual'])).toEqual([]);
    expect(sessionNames(['ext:p1:manual'])).toEqual([]);
  });

  it('no globs, no server:tool selectors, unknown names and zcc-inbox select nothing', () => {
    expect(sessionNames(['plugin:*', '*', 'manual:tool', 'plugin:p1', 'nope', 'zcc-inbox'])).toEqual([]);
  });

  it('zcc-inbox is the only always-allowed server in every mode', () => {
    const none = mod.ensureMcpConfigForProjectSync('proj-a', []);
    const some = mod.ensureMcpConfigForProjectSync('proj-b', ['plugin:p1:manual']);
    for (const p of [none, some]) expect(JSON.parse(readFileSync(p, 'utf8')).mcpServers['zcc-inbox']).toBeDefined();
    expect(bodyKeys(some)).toEqual(['plugin:p1:manual']);
  });

  it('config body, session servers and wildcards agree and the wildcards equal the loaded alwaysOn set', () => {
    // all mode
    expect(mod.alwaysOnPluginMcpAllowlist().sort()).toEqual(['mcp__plugin_p1_auto', 'mcp__plugin_p2_auto']);
    expect(mod.alwaysOnPluginMcpAllowlist(undefined)).toEqual(mod.alwaysOnPluginMcpAllowlist());
    // allowlist mode naming one alwaysOn and one manual server
    const list = ['plugin:p2:auto', 'plugin:p1:manual'];
    const keys = bodyKeys(mod.ensureMcpConfigForProjectSync('proj-agree', list));
    expect(keys).toEqual(['plugin:p1:manual', 'plugin:p2:auto']);
    expect(sessionNames(list)).toEqual(keys.map((k) => k.replace(/:/g, '_')));
    expect(mod.alwaysOnPluginMcpAllowlist(list)).toEqual(['mcp__plugin_p2_auto']);
    // every wildcard names a server the body carries
    for (const w of mod.alwaysOnPluginMcpAllowlist(list)) expect(keys.map((k) => `mcp__${k.replace(/:/g, '_')}`)).toContain(w);
  });

  it('a user-style bare name never matches a prefixed registry key by suffix', () => {
    expect(sessionNames(['p1:manual', 'plugin_p1_manual'])).toEqual([]);
  });

  it('unset-persona output is unchanged: same bytes as the all-mode body', () => {
    const a = mod.ensureMcpConfigForProjectSync('proj-unset');
    const b = mod.ensureMcpConfigForProjectSync('proj-unset', undefined);
    expect(readFileSync(a, 'utf8')).toBe(readFileSync(b, 'utf8'));
    expect(bodyKeys(a)).toEqual(['plugin:p1:auto', 'plugin:p2:auto']);
  });
});

describe('per-session allowlist file', () => {
  it('two sessions of one project with different allowlists do not overwrite each other', () => {
    const a = mod.ensureSessionMcpConfigSync('proj-c', 'sess-a', ['plugin:p1:manual']);
    const b = mod.ensureSessionMcpConfigSync('proj-c', 'sess-b', []);
    expect(a).not.toBe(b);
    expect(bodyKeys(a)).toEqual(['plugin:p1:manual']);
    expect(bodyKeys(b)).toEqual([]);
    // shared per-project file untouched
    expect(existsSync(mod.mcpConfigPathForProject('proj-c'))).toBe(false);
  });

  it('writes mode 0600 and leaves no tmp files', () => {
    const p = mod.ensureSessionMcpConfigSync('proj-d', 'sess-1', ['manual']);
    if (process.platform !== 'win32') expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(p, '..')).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('is idempotent and rewrites for the same session', () => {
    mod.ensureSessionMcpConfigSync('proj-e', 's', ['plugin:p1:manual']);
    const p = mod.ensureSessionMcpConfigSync('proj-e', 's', []);
    expect(bodyKeys(p)).toEqual([]);
  });

  it('rejects ids that could escape the sessions dir', () => {
    expect(() => mod.ensureSessionMcpConfigSync('../x', 's', [])).toThrow(/invalid/);
    expect(() => mod.ensureSessionMcpConfigSync('p', 'a/b', [])).toThrow(/invalid/);
    expect(() => mod.sessionMcpConfigPath('p', '')).toThrow(/invalid/);
  });

  it('cleans up the tmp file and rethrows when the rename fails', () => {
    // Make the target a non-empty directory so rename(file -> dir) fails.
    const target = mod.sessionMcpConfigPath('proj-f', 'blocked');
    mod.ensureSessionMcpConfigSync('proj-f', 'seed', []);
    rmSync(target, { force: true });
    const { mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'x'), '1');
    expect(() => mod.ensureSessionMcpConfigSync('proj-f', 'blocked', [])).toThrow();
    expect(readdirSync(join(target, '..')).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('removeSessionMcpConfig deletes the file and never throws', () => {
    const p = mod.ensureSessionMcpConfigSync('proj-g', 's', []);
    mod.removeSessionMcpConfig('proj-g', 's');
    expect(existsSync(p)).toBe(false);
    expect(() => mod.removeSessionMcpConfig('proj-g', 's')).not.toThrow();
    expect(() => mod.removeSessionMcpConfig('../bad', 's')).not.toThrow();
  });
});
