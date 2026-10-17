import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  consumePeerBootKey: vi.fn(),
  startProductServer: vi.fn(),
  attachProductPluginService: vi.fn(async () => {})
}));

vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), writeFileSync: vi.fn() }));
vi.mock('../services/peers/protected-key.js', () => ({ consumePeerBootKey: deps.consumePeerBootKey }));
vi.mock('./product-server.js', () => ({ startProductServer: deps.startProductServer }));
vi.mock('./product-plugins.js', () => ({ attachProductPluginService: deps.attachProductPluginService }));
vi.mock('./ports.js', () => ({ DEFAULT_DEV_APP_PORT: 5173, serverPortFromEnv: () => 8780 }));
vi.mock('@zana-ai/zcc-host-daemon/host-config', () => ({ resolveZccDataDir: () => '/test/data' }));
vi.mock('../services/agents/modern-team-launch-config.js', () => ({ standaloneModernTeamLaunchSource: () => 'tools' }));
vi.mock('./team-ops-via-control.js', () => ({ createTeamOpsViaControl: () => 'teams' }));
vi.mock('./cli-agent-ops.js', () => ({ retainProductServerCredential: vi.fn(), createCliAgentOpsViaControl: () => 'agents' }));

describe('listen peer boot key', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    deps.startProductServer.mockResolvedValue({ url: 'http://127.0.0.1:8780/', ctx: { config: { getConfig: vi.fn() } }, close: vi.fn(async () => {}) });
  });

  it('reports the key present, zeroes the in-memory copy, and hands the provider to the server', async () => {
    const key = Buffer.alloc(32, 7);
    const provider = { getKey: vi.fn(async () => key) };
    deps.consumePeerBootKey.mockReturnValue(provider);
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await import('./listen.js');
    const lines = write.mock.calls.map((call) => String(call[0]));
    write.mockRestore();
    expect(lines).toContain('zcc-server peer key: present\n');
    expect(key.every((byte) => byte === 0)).toBe(true);
    expect(deps.startProductServer).toHaveBeenCalledWith(expect.objectContaining({ peerKeyProvider: provider }));
  });

  it('degrades to absent and warns when the key provider rejects with an Error', async () => {
    deps.consumePeerBootKey.mockReturnValue({ getKey: vi.fn(async () => { throw new Error('keychain locked'); }) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await import('./listen.js');
    const lines = write.mock.calls.map((call) => String(call[0]));
    write.mockRestore();
    expect(warn).toHaveBeenCalledWith('[zcc] peer key unavailable: keychain locked');
    warn.mockRestore();
    expect(lines.some((line) => line.startsWith('zcc-server peer key: absent'))).toBe(true);
    expect(deps.startProductServer).toHaveBeenCalledOnce();
  });

  it('stringifies non-Error rejections and treats a null key as absent', async () => {
    deps.consumePeerBootKey.mockReturnValue({ getKey: vi.fn(async () => { throw 'boom'; }) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await import('./listen.js');
    write.mockRestore();
    expect(warn).toHaveBeenCalledWith('[zcc] peer key unavailable: boom');
    warn.mockRestore();

    vi.resetModules();
    deps.consumePeerBootKey.mockReturnValue({ getKey: vi.fn(async () => null) });
    const write2 = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await import('./listen.js');
    const lines = write2.mock.calls.map((call) => String(call[0]));
    write2.mockRestore();
    expect(lines.some((line) => line.startsWith('zcc-server peer key: absent'))).toBe(true);
  });
});
