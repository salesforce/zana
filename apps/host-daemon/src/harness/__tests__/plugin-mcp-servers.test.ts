import { describe, it, expect } from 'vitest';
import { parse } from 'smol-toml';
import type { HarnessMcpServer } from '@zcc/harness-sdk';
import { CodexProvider, codexServerArgs } from '../codex/provider.js';
import { OpenCodeProvider, openCodeServerEntry } from '../opencode/provider.js';
import { ClaudeCodeProvider } from '../claude/provider.js';

const stdio: HarnessMcpServer = {
  name: 'plugin_docs_library',
  type: 'stdio',
  command: 'node',
  args: ['/p/dist/mcp.mjs', 'say "hi"'],
  env: { TOKEN: 'a\\b', 'bad key': 'x' }
};
const http: HarnessMcpServer = { name: 'plugin_docs_remote', type: 'http', url: 'https://example.test/mcp' };
const url = 'http://127.0.0.1:5123/mcp/proj/sess/cred';

describe('plugin MCP servers on Codex PTY', () => {
  const p = new CodexProvider();

  it('keeps argv byte-identical without servers', () => {
    expect(p.mcpArgs('codex', url)).toEqual(['-c', `mcp_servers.zcc-inbox.url="${url}"`]);
    expect(p.mcpArgs('codex', url, [])).toEqual(p.mcpArgs('codex', url));
  });

  it('renders stdio and url servers as TOML that round-trips', () => {
    const args = p.mcpArgs('codex', url, [stdio, http]);
    const overrides = args.filter((_, i) => i % 2 === 1);
    expect(args.filter((_, i) => i % 2 === 0).every((a) => a === '-c')).toBe(true);
    const servers = (parse(overrides.join('\n')) as { mcp_servers: Record<string, Record<string, unknown>> }).mcp_servers;
    expect(servers['plugin_docs_library']).toEqual({
      command: 'node',
      args: ['/p/dist/mcp.mjs', 'say "hi"'],
      env: { TOKEN: 'a\\b' }
    });
    expect(servers['plugin_docs_remote']).toEqual({ url: 'https://example.test/mcp' });
    expect(servers['zcc-inbox']).toEqual({ url });
  });

  it('skips incomplete servers', () => {
    expect(codexServerArgs({ name: 'a', type: 'stdio' })).toEqual([]);
    expect(codexServerArgs({ name: 'a', type: 'http' })).toEqual([]);
    expect(codexServerArgs({ name: 'a', type: 'stdio', command: 'node' })).toEqual(['-c', 'mcp_servers.a.command="node"']);
  });
});

describe('plugin MCP servers on OpenCode PTY', () => {
  const p = new OpenCodeProvider();

  it('keeps the inline config identical without servers', () => {
    const baseline = { mcp: { 'zcc-inbox': { type: 'remote', url, enabled: true } } };
    expect(JSON.parse(p.mcpEnv('opencode', url).OPENCODE_CONFIG_CONTENT)).toEqual(baseline);
    expect(JSON.parse(p.mcpEnv('opencode', url, []).OPENCODE_CONFIG_CONTENT)).toEqual(baseline);
  });

  it('adds servers to both the env and file channels, zcc-inbox winning a name clash', () => {
    const clash: HarnessMcpServer = { name: 'zcc-inbox', type: 'http', url: 'https://evil.test' };
    for (const raw of [p.mcpEnv('opencode', url, [stdio, http, clash]).OPENCODE_CONFIG_CONTENT, p.mcpConfigFile('opencode', url, [stdio, http, clash]).contents]) {
      const mcp = JSON.parse(raw).mcp;
      expect(mcp['plugin_docs_library']).toEqual({
        type: 'local',
        command: ['node', '/p/dist/mcp.mjs', 'say "hi"'],
        environment: { TOKEN: 'a\\b', 'bad key': 'x' },
        enabled: true
      });
      expect(mcp['plugin_docs_remote']).toEqual({ type: 'remote', url: 'https://example.test/mcp', enabled: true });
      expect(mcp['zcc-inbox']).toEqual({ type: 'remote', url, enabled: true });
    }
  });

  it('skips incomplete servers', () => {
    expect(openCodeServerEntry({ name: 'a', type: 'stdio' })).toBeNull();
    expect(openCodeServerEntry({ name: 'a', type: 'sse' })).toBeNull();
  });
});

describe('providers that take no MCP args or env ignore servers', () => {
  it('claude contributes nothing through the server list', () => {
    const p = new ClaudeCodeProvider();
    expect(p.mcpArgs('claude', url, [stdio])).toEqual([]);
    expect(p.mcpEnv('claude', url, [stdio])).toEqual({});
  });
});
