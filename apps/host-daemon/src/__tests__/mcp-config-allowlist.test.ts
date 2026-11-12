import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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

describe('per-session strict-mode file (prepareSessionMcpConfig)', () => {
  let dir: string;
  let claudeDir: string;
  let cwd: string;
  let n = 0;
  const run = (allowlist: string[], sessionId = `sess-${++n}`) =>
    mod.prepareSessionMcpConfig({ dir, sessionId, allowlist, cwd, env: { CLAUDE_CONFIG_DIR: claudeDir } as NodeJS.ProcessEnv });
  const servers = (path: string) => JSON.parse(readFileSync(path, 'utf8')).mcpServers as Record<string, Record<string, unknown>>;
  const names = (path: string) => Object.keys(servers(path)).sort();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cc-sess-mcp-'));
    claudeDir = mkdtempSync(join(tmpdir(), 'cc-claude-'));
    cwd = mkdtempSync(join(tmpdir(), 'cc-proj-'));
    writeFileSync(
      join(claudeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          usrA: {
            type: 'stdio',
            command: 'node',
            args: ['a.js'],
            env: { API_KEY: 'SECRET-ENV' },
            headers: { Authorization: 'Bearer SECRET-HDR' },
            oauth: { clientId: 'SECRET-OAUTH' },
            auth: { token: 'SECRET-AUTH' }
          },
          usrB: { command: 'node', args: ['b.js'] },
          shared: { command: 'user-wins' },
          'plugin:evil:x': { command: 'node' }
        }
      })
    );
    writeFileSync(
      join(cwd, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          projC: { type: 'http', url: 'https://proj.example/mcp', headers: { 'X-Key': 'SECRET-PROJ' }, env: { K: 'SECRET-PENV' } },
          shared: { command: 'project-loses' }
        }
      })
    );
  });
  afterEach(() => {
    for (const d of [dir, claudeDir, cwd]) rmSync(d, { recursive: true, force: true });
  });

  it('[] writes zcc-inbox only: no user, project or registry server', () => {
    const { path, warnings } = run([]);
    expect(names(path)).toEqual(['zcc-inbox']);
    expect(servers(path)['zcc-inbox']).toEqual({ type: 'streamable-http', url: '${ZCC_MCP_URL}' });
    expect(warnings).toEqual([]);
  });

  it('a list keeps exactly the allowlisted user, project and registry servers plus zcc-inbox', () => {
    const { path } = run(['usrA', 'projC', 'plugin:p1:manual']);
    expect(names(path)).toEqual(['plugin:p1:manual', 'projC', 'usrA', 'zcc-inbox']);
    expect(servers(path).usrA).toEqual({ type: 'stdio', command: 'node', args: ['a.js'] });
  });

  it('a user server beats a project server of the same name', () => {
    expect(servers(run(['shared']).path).shared).toEqual({ command: 'user-wins' });
  });

  it('drops reserved plugin:/ext: user names and never lets a user server shadow zcc-inbox', () => {
    writeFileSync(join(claudeDir, '.claude.json'), JSON.stringify({ mcpServers: { 'plugin:evil:x': { command: 'node' }, 'zcc-inbox': { command: 'evil' } } }));
    const { path } = run(['plugin:evil:x', 'zcc-inbox']);
    expect(names(path)).toEqual(['zcc-inbox']);
    expect(servers(path)['zcc-inbox']).toEqual({ type: 'streamable-http', url: '${ZCC_MCP_URL}' });
  });

  it('AC-13: no credential field or secret value reaches the file', () => {
    const { path } = run(['usrA', 'projC']);
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/SECRET/);
    for (const name of ['usrA', 'projC']) {
      for (const field of ['env', 'headers', 'oauth', 'auth', 'headersHelper']) {
        expect(servers(path)[name]).not.toHaveProperty(field);
      }
    }
  });

  it('AC-15: names each allowlisted server that lost credentials, is missing, or is unsafe', () => {
    writeFileSync(
      join(claudeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          usrA: { command: 'node', env: { K: 'v' } },
          leaky: { command: 'node', args: ['--token=abcdef123456'] }
        }
      })
    );
    const { warnings } = run(['usrA', 'ghost', 'leaky']);
    const by = Object.fromEntries(warnings.map((w) => [w.server, w.reason]));
    expect(by).toEqual({ usrA: 'credentials-stripped', ghost: 'not-found', leaky: 'unsafe-config' });
    expect(JSON.stringify(warnings)).not.toMatch(/abcdef123456/);
  });

  it('a bare entry that a registered plugin server answers to is not reported missing', () => {
    expect(run(['manual']).warnings).toEqual([]);
    expect(mod.externallyProvidedAllowlistEntries(['manual', 'plugin:p1:manual', 'ghost'])).toEqual(['manual', 'plugin:p1:manual']);
  });

  it('tolerates a missing, malformed or oversized config', () => {
    rmSync(join(claudeDir, '.claude.json'));
    rmSync(join(cwd, '.mcp.json'));
    expect(names(run(['usrA']).path)).toEqual(['zcc-inbox']);
    writeFileSync(join(claudeDir, '.claude.json'), '{not json');
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: ['x'] }));
    expect(names(run(['usrA']).path)).toEqual(['zcc-inbox']);
    writeFileSync(join(claudeDir, '.claude.json'), JSON.stringify({ pad: 'x'.repeat(17 * 1024 * 1024) }));
    expect(names(run(['usrA']).path)).toEqual(['zcc-inbox']);
  });

  it('works without a cwd and with the default environment', () => {
    const { path } = mod.prepareSessionMcpConfig({ dir, sessionId: 'no-cwd', allowlist: [], env: { CLAUDE_CONFIG_DIR: claudeDir } as NodeJS.ProcessEnv });
    expect(names(path)).toEqual(['zcc-inbox']);
    expect(names(mod.prepareSessionMcpConfig({ dir, sessionId: 'dflt', allowlist: [] }).path)).toEqual(['zcc-inbox']);
  });

  it('two sessions with different allowlists never share a path or overwrite each other', () => {
    const a = run(['usrA'], 'sess-a').path;
    const b = run([], 'sess-b').path;
    expect(a).not.toBe(b);
    expect(names(a)).toEqual(['usrA', 'zcc-inbox']);
    expect(names(b)).toEqual(['zcc-inbox']);
    expect(existsSync(mod.mcpConfigPathForProject('proj-c'))).toBe(false);
  });

  it('writes mode 0600 at <dir>/<sessionId>.json and leaves no tmp files', () => {
    const { path } = run(['usrA'], 'sess-mode');
    expect(path).toBe(join(dir, 'sess-mode.json'));
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('rejects ids that could escape the dir', () => {
    expect(() => run([], '../x')).toThrow(/invalid/);
    expect(() => run([], 'a/b')).toThrow(/invalid/);
    expect(() => mod.sessionMcpConfigPath(dir, '')).toThrow(/invalid/);
  });

  it('cleans up the tmp file and rethrows when the rename fails', () => {
    const target = mod.sessionMcpConfigPath(dir, 'blocked');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'x'), '1');
    expect(() => run([], 'blocked')).toThrow();
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });
});
