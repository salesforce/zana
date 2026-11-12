import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALWAYS_ALLOWED_MCP_SERVERS } from '@zana-ai/zcc-domain/product';
import { allowlistIgnoredWarning, MAX_DISABLED_MCP_SERVERS, planUserMcpDisable } from '../mcp-allowlist-disable.js';
import { enumerateCodexUserMcpServers, MAX_CODEX_CONFIG_BYTES } from '../harness/codex/user-mcp-servers.js';
import { enumerateOpenCodeUserMcpServers, MAX_OPENCODE_CONFIG_BYTES, stripJsonc } from '../harness/opencode/user-mcp-servers.js';
import { CodexProvider } from '../harness/codex/provider.js';
import { OpenCodeProvider } from '../harness/opencode/provider.js';

const plan = (over: Partial<Parameters<typeof planUserMcpDisable>[0]> = {}) =>
  planUserMcpDisable({ allowlist: [], enumeration: { names: [] }, injectedNames: new Set(), externallyProvided: [], ...over });

describe('planUserMcpDisable', () => {
  it('pins the always-allowed constant to zcc-inbox', () => {
    expect([...ALWAYS_ALLOWED_MCP_SERVERS]).toEqual(['zcc-inbox']);
  });
  it('[] disables every user name except zcc-inbox and Zana-injected names', () => {
    const r = plan({ enumeration: { names: ['a', 'zcc-inbox', 'plugin_x', 'a'] }, injectedNames: new Set(['plugin_x']) });
    expect(r.disabled).toEqual(['a']);
    expect(r.warnings).toEqual([]);
  });
  it('a list keeps covered names and disables the rest', () => {
    const r = plan({ allowlist: ['a'], enumeration: { names: ['a', 'b'] } });
    expect(r.disabled).toEqual(['b']);
  });
  it('warns by name for an allowlisted server that does not exist, but not for zcc-inbox, plugin:/ext: or externally provided entries', () => {
    const r = plan({ allowlist: ['ghost', 'zcc-inbox', 'plugin:p:s', 'ext:e:s', 'reg'], externallyProvided: ['reg'] });
    expect(r.warnings.map((w) => [w.code, w.server])).toEqual([['allowlisted-mcp-not-found', 'ghost']]);
  });
  it('reports a non-bare-key name instead of disabling it and sanitises the printed name', () => {
    const r = plan({ enumeration: { names: ['bad.name', `x\u0001${'y'.repeat(100)}`] } });
    expect(r.disabled).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['mcp-allowlist-not-disabled', 'mcp-allowlist-not-disabled']);
    expect(r.warnings[1]!.server).toMatch(/^x\?y+\.\.\.$/);
  });
  it('caps the number of disabled names and says so', () => {
    const names = Array.from({ length: MAX_DISABLED_MCP_SERVERS + 5 }, (_, i) => `s${i}`);
    const r = plan({ enumeration: { names } });
    expect(r.disabled).toHaveLength(MAX_DISABLED_MCP_SERVERS);
    expect(r.warnings.map((w) => w.code)).toEqual(['mcp-allowlist-truncated']);
  });
  it('flags an unreadable config', () => {
    expect(plan({ enumeration: { names: [], unreadable: true } }).warnings.map((w) => w.code)).toEqual(['mcp-allowlist-config-unreadable']);
  });
  it('allowlistIgnoredWarning carries the reason', () => {
    expect(allowlistIgnoredWarning('why')).toEqual({ code: 'mcp-allowlist-ignored', message: "The persona's MCP server allowlist is ignored: why." });
  });
});

describe('user MCP enumerators', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zcc-enum-'));
    mkdirSync(join(root, 'cwd'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const cwd = () => join(root, 'cwd');

  it('codex: missing files give no names and are not unreadable; defaults to ~/.codex when CODEX_HOME is unset', () => {
    expect(enumerateCodexUserMcpServers({ cwd: cwd(), env: { CODEX_HOME: join(root, 'none') } })).toEqual({ names: [] });
    expect(enumerateCodexUserMcpServers({ cwd: cwd(), env: { HOME: root } as never }).names).toBeInstanceOf(Array);
  });
  it('codex: merges global and project keys only', () => {
    mkdirSync(join(root, 'h'));
    writeFileSync(join(root, 'h', 'config.toml'), '[mcp_servers.a]\ncommand="x"\n[mcp_servers.a.env]\nK="SECRET"\n');
    mkdirSync(join(cwd(), '.codex'));
    writeFileSync(join(cwd(), '.codex', 'config.toml'), '[mcp_servers.b]\nurl="u"\n');
    const r = enumerateCodexUserMcpServers({ cwd: cwd(), env: { CODEX_HOME: join(root, 'h') } });
    expect(r.names.sort()).toEqual(['a', 'b']);
    expect(JSON.stringify(r)).not.toContain('SECRET');
  });
  it('codex: invalid toml, oversize file and non-table mcp_servers are unreadable', () => {
    mkdirSync(join(root, 'h'));
    const f = join(root, 'h', 'config.toml');
    const env = { CODEX_HOME: join(root, 'h') };
    writeFileSync(f, 'a = = b');
    expect(enumerateCodexUserMcpServers({ cwd: cwd(), env }).unreadable).toBe(true);
    writeFileSync(f, `# ${'x'.repeat(MAX_CODEX_CONFIG_BYTES)}\n`);
    expect(enumerateCodexUserMcpServers({ cwd: cwd(), env }).unreadable).toBe(true);
    writeFileSync(f, 'mcp_servers = 3\n');
    expect(enumerateCodexUserMcpServers({ cwd: cwd(), env }).unreadable).toBe(true);
    writeFileSync(f, 'x = 1\n');
    expect(enumerateCodexUserMcpServers({ cwd: cwd(), env })).toEqual({ names: [] });
  });

  it('stripJsonc removes comments and trailing commas but not string contents', () => {
    const out = stripJsonc('{"u":"http://a//b /* x */", /* c */ "k":[1,2,], // t\n}');
    expect(JSON.parse(out)).toEqual({ u: 'http://a//b /* x */', k: [1, 2] });
    expect(stripJsonc('{"a":"q\\"//z"} /* open')).toContain('q\\"//z');
  });
  it('opencode: reads global, user OPENCODE_CONFIG and project files, keys only', () => {
    mkdirSync(join(root, 'xdg', 'opencode'), { recursive: true });
    writeFileSync(join(root, 'xdg', 'opencode', 'opencode.json'), JSON.stringify({ mcp: { g: { environment: { K: 'SECRET' } } } }));
    writeFileSync(join(root, 'own.jsonc'), '{ "mcp": { "o": {}, }, }');
    writeFileSync(join(cwd(), 'opencode.json'), JSON.stringify({ mcp: { p: {} } }));
    const r = enumerateOpenCodeUserMcpServers({ cwd: cwd(), env: { XDG_CONFIG_HOME: join(root, 'xdg'), OPENCODE_CONFIG: join(root, 'own.jsonc') } });
    expect(r.names.sort()).toEqual(['g', 'o', 'p']);
    expect(JSON.stringify(r)).not.toContain('SECRET');
  });
  it('opencode: missing is fine; bad json, array root, bad mcp and oversize are unreadable; absent mcp is fine', () => {
    const env = { XDG_CONFIG_HOME: join(root, 'xdg') };
    expect(enumerateOpenCodeUserMcpServers({ cwd: cwd(), env })).toEqual({ names: [] });
    expect(enumerateOpenCodeUserMcpServers({ cwd: cwd(), env: { HOME: root } as never }).names).toBeInstanceOf(Array);
    const f = join(cwd(), 'opencode.json');
    for (const body of ['{nope', '[]', '{"mcp":[]}', '{"mcp":3}', ' '.repeat(MAX_OPENCODE_CONFIG_BYTES + 1)]) {
      writeFileSync(f, body);
      expect(enumerateOpenCodeUserMcpServers({ cwd: cwd(), env }).unreadable).toBe(true);
    }
    writeFileSync(f, '{"theme":"x"}');
    expect(enumerateOpenCodeUserMcpServers({ cwd: cwd(), env })).toEqual({ names: [] });
  });
});

describe('provider seams', () => {
  const url = 'http://127.0.0.1:1/mcp/p/s/t';
  it('codex mcpArgs appends disables after zcc-inbox and skips non-bare names', () => {
    const args = new CodexProvider().mcpArgs('codex', url, undefined, ['a-1', 'b.c', 'd e']);
    expect(args.slice(-2)).toEqual(['-c', 'mcp_servers.a-1.enabled=false']);
    expect(args.join(' ')).not.toContain('b.c');
    expect(args.join(' ')).not.toContain('d e');
    expect(new CodexProvider().mcpArgs('codex', url)).toEqual(new CodexProvider().mcpArgs('codex', url, undefined, []));
  });
  it('codex declares mcp-references locally, not remotely', () => {
    const caps = new CodexProvider().adapter.descriptor.capabilities['mcp-references'];
    expect(caps.local.support).toBe('exact');
    expect(caps.local.evidence?.id).toBe('codex.facet.mcp-references');
    expect(caps.remote.support).toBe('unsupported');
  });
  it('opencode mcpConfigFile adds name-only disables, never overrides Zana keys, no change when none', () => {
    const p = new OpenCodeProvider();
    const base = p.mcpConfigFile('opencode', url);
    expect(p.mcpConfigFile('opencode', url, undefined, undefined, [])).toEqual(base);
    const f = JSON.parse(p.mcpConfigFile('opencode', url, undefined, undefined, ['u1', 'zcc-inbox']).contents);
    expect(f.mcp.u1).toEqual({ enabled: false });
    expect(f.mcp['zcc-inbox']).toMatchObject({ enabled: true });
  });
  it('providers without enumeration return null', async () => {
    const { providerFor } = await import('../harness/registry.js');
    expect(providerFor('shell').enumerateUserMcpServers({ cwd: '/tmp', env: {} })).toBeNull();
  });
});
