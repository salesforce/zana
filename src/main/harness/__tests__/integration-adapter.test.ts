import { describe, expect, it } from 'vitest';
import { HARNESS_REGISTRATIONS, providerFor } from '../registry.js';

describe('HarnessIntegrationAdapter compatibility bridge', () => {
  it('preserves Codex MCP, guidance, hooks, and auth channels', () => {
    const result = providerFor('codex').integration.configure({
      profile: 'codex',
      mcp: { url: 'http://127.0.0.1/mcp/p/s' },
      guidance: 'Use inbox_push.',
      lifecycle: { stop: 'http://127.0.0.1/hook/stop/p/s' },
      auth: { baseUrl: 'https://api.example.test', token: 'secret' }
    });
    expect(result.mcpArgs).toContain('mcp_servers.zcc-inbox.url="http://127.0.0.1/mcp/p/s"');
    expect(result.guidanceArgs).toContain('developer_instructions="Use inbox_push."');
    expect(result.hookArgs).toContain('--dangerously-bypass-hook-trust');
    expect(result.authArgs).toContain('model_provider="zcc"');
    expect(result.authEnv).toEqual({ ZCC_CODEX_KEY: 'secret' });
  });

  it('preserves OpenCode MCP environment injection', () => {
    const result = providerFor('opencode').integration.configure({
      profile: 'opencode',
      mcp: { url: 'http://127.0.0.1/mcp/p/s' }
    });
    expect(JSON.parse(result.mcpEnv!.OPENCODE_CONFIG_CONTENT!)).toEqual({
      mcp: { 'zcc-inbox': { type: 'remote', url: 'http://127.0.0.1/mcp/p/s', enabled: true } }
    });
  });

  it('declares MCP injection or an explicit unavailable surface for every harness profile', () => {
    const url = 'http://127.0.0.1/mcp/project/session';
    for (const registration of HARNESS_REGISTRATIONS) {
      for (const { id: profile } of registration.profiles) {
        const provider = providerFor(profile);
        const configured = provider.integration.configure({ profile, mcp: { url } });
        const injectsMcp = provider.capabilities(profile).injectsClaudeMcpConfig
          || (configured.mcpArgs ?? []).some((arg) => arg.includes(url))
          || Object.values(configured.mcpEnv ?? {}).some((value) => value.includes(url));
        if (injectsMcp) continue;
        expect(configured.mcpArgs ?? []).toEqual([]);
        expect(configured.mcpEnv).toEqual({});
      }
    }
  });
});
