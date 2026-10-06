import { afterEach, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  retainProductServerCredential: vi.fn(),
  startProductServer: vi.fn(),
  attachProductPluginService: vi.fn(async () => {}),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn()
}));

vi.mock('node:fs', () => ({ mkdirSync: deps.mkdirSync, writeFileSync: deps.writeFileSync }));
vi.mock('./product-server.js', () => ({ startProductServer: deps.startProductServer }));
vi.mock('./product-plugins.js', () => ({ attachProductPluginService: deps.attachProductPluginService }));
vi.mock('./ports.js', () => ({ DEFAULT_DEV_APP_PORT: 5173, serverPortFromEnv: () => 8780 }));
vi.mock('@zana-ai/zcc-host-daemon/host-config', () => ({ resolveZccDataDir: () => '/test/data' }));
vi.mock('../services/agents/modern-team-launch-config.js', () => ({ standaloneModernTeamLaunchSource: () => 'tools' }));
vi.mock('./team-ops-via-control.js', () => ({ createTeamOpsViaControl: () => 'teams' }));
vi.mock('./cli-agent-ops.js', () => ({
  retainProductServerCredential: deps.retainProductServerCredential,
  createCliAgentOpsViaControl: () => 'agents'
}));

const previousCredential = process.env.ZCC_PRODUCT_SERVER_CREDENTIAL;

afterEach(() => {
  if (previousCredential === undefined) delete process.env.ZCC_PRODUCT_SERVER_CREDENTIAL;
  else process.env.ZCC_PRODUCT_SERVER_CREDENTIAL = previousCredential;
});

it('retains credential for authorized send but removes it before server and plugin children start', async () => {
  process.env.ZCC_PRODUCT_SERVER_CREDENTIAL = 'desktop-only-secret';
  const ctx = { config: { getConfig: vi.fn() } };
  deps.startProductServer.mockImplementationOnce(async (options: unknown) => {
    expect(process.env.ZCC_PRODUCT_SERVER_CREDENTIAL).toBeUndefined();
    return { url: 'http://127.0.0.1:8780/', ctx, close: vi.fn(async () => {}) };
  });
  deps.attachProductPluginService.mockImplementationOnce(async () => {
    expect(process.env.ZCC_PRODUCT_SERVER_CREDENTIAL).toBeUndefined();
  });

  await import('./listen.js');

  expect(deps.retainProductServerCredential).toHaveBeenCalledExactlyOnceWith('desktop-only-secret');
  expect(deps.startProductServer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    host: '127.0.0.1', port: 8780, dataDir: '/test/data', uiSendSecret: 'desktop-only-secret'
  }));
  expect(deps.attachProductPluginService).toHaveBeenCalledExactlyOnceWith(ctx, { hostAgentToolSource: 'tools' });
});
