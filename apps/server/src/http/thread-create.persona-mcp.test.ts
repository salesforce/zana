import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ events: [] as Array<{ payload: { operation: string; message: string } }>, patches: [] as unknown[] }));

vi.mock('@zana-ai/zcc-db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zana-ai/zcc-db')>()),
  listExecutionHosts: () => [{ id: 'h1', label: 'Local', kind: 'local', status: 'online' }],
  getPrimaryHost: () => ({ id: 'h1' }),
  createEnvironment: (_db: unknown, row: Record<string, unknown>) => row,
  createThread: (_db: unknown, row: Record<string, unknown>) => ({ ...row, id: 't1' }),
  getEnvironment: () => null,
  updateEnvironmentDiscovery: vi.fn(),
  updateEnvironmentStatus: vi.fn(),
  updateThreadStatus: (_db: unknown, id: string, status: string) => ({ id, status }),
  appendConversationThreadEvent: (_db: unknown, input: { threadId: string; type: string; payload: { operation: string; message: string } }) => {
    state.events.push(input);
    return { threadId: input.threadId, sequence: 1, type: input.type, payload: input.payload };
  },
  patchThreadPluginMetadata: (_db: unknown, input: unknown) => { state.patches.push(input); return { ok: true }; }
}));
vi.mock('../services/threads/remote-tool-proxy.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/threads/remote-tool-proxy.js')>()),
  isRemoteToolProxyActive: () => false,
  resolveHarnessWorkspacePath: async () => '/tmp/p'
}));
vi.mock('../services/threads/spawn-choice-for-host.js', () => ({
  resolveSpawnChoiceForHost: () => ({ ok: true, choice: { kind: 'unmanaged' }, dropCwd: false })
}));
vi.mock('../services/threads/workspace-path-claims.js', () => ({ unmanagedAttachRefusal: () => null }));
vi.mock('../services/threads/spawn-environment-provision.js', () => ({ provisionCommandFor: () => ({ type: 'environment.provision' }) }));

import { createThreadFromRequest, resetPersonaMcpLegacyNoticeState } from './thread-create.js';

const dataDir = mkdtempSync(join(tmpdir(), 'zcc-thread-persona-mcp-'));
mkdirSync(join(dataDir, 'personas'));
const write = (id: string, extra: object) =>
  writeFileSync(join(dataDir, 'personas', `${id}.json`), JSON.stringify({ id, name: id, baseProfile: 'claude', ...extra }));
write('restricted', { mcpServers: ['github'] });
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

function run(providerId: string, personaId?: string, headless?: boolean) {
  const calls: Array<{ command: Record<string, unknown> & { type: string } }> = [];
  const ctx = {
    db: { transaction: (fn: () => unknown) => fn() },
    dataDir,
    hub: { emit: vi.fn() },
    toProjects: () => [{ id: 'p1', name: 'p', path: '/tmp/p' }],
    config: { getConfig: () => ({ remoteDefaultPath: '~/work' }) },
    hostHub: {
      resolveHostId: (id: string) => id,
      ensureHostSessionReady: vi.fn(),
      callHostOnlineRpc: vi.fn(async (call: { command: { type: string } }) => {
        calls.push(call as never);
        if (call.command.type === 'provider.status') {
          return { providers: [{ family: 'claude', installed: true, enabled: true }] };
        }
        if (call.command.type === 'environment.provision') return { path: '/tmp/p', isGitRepo: false, isWorktree: false };
        return {};
      })
    }
  } as never;
  return createThreadFromRequest(ctx, { projectId: 'p1', providerId, personaId, headless, input: ['hi'] } as never)
    .then((thread) => ({ thread, calls }));
}

describe('createThreadFromRequest persona MCP allowlist on thread.start', () => {
  beforeEach(() => { state.events.length = 0; state.patches.length = 0; resetPersonaMcpLegacyNoticeState(); });

  it('sends the main-resolved mcpAllowlist in providerOptions, persists it and emits notices', async () => {
    const { calls } = await run('claude', 'restricted');
    const start = calls.find((c) => c.command.type === 'thread.start')!.command as { providerOptions?: { mcpAllowlist?: string[] } };
    expect(start.providerOptions?.mcpAllowlist).toEqual(expect.arrayContaining(['github', 'zcc-inbox']));
    expect(state.patches.length).toBeGreaterThan(0);
    expect(state.events.map((e) => e.payload.operation)).toContain('persona_mcp_legacy_value');
  });

  it('omits providerOptions and notices for a persona-less launch', async () => {
    const { calls } = await run('claude');
    const start = calls.find((c) => c.command.type === 'thread.start')!.command;
    expect(start.providerOptions).toBeUndefined();
    expect(state.events).toHaveLength(0);
  });

  it('shell launches skip the legacy-value notice', async () => {
    await run('shell', 'restricted');
    expect(state.events.map((e) => e.payload.operation)).not.toContain('persona_mcp_legacy_value');
  });
});
