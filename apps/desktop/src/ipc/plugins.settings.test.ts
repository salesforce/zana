import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindIpcCtx } from './ctx.js';

vi.mock('electron', () => ({ ipcMain: {} }));
vi.mock('@zana-ai/zcc-server/services/mcp/mcp', () => ({ listMcpServers: vi.fn(), setMcpServerEnabled: vi.fn() }));
vi.mock('@zana-ai/zcc-server/services/mcp/mcp-catalogue', () => ({ listMcpServersAll: vi.fn(), setMcpServerEnabledById: vi.fn(), revealMcpServer: vi.fn() }));
vi.mock('@zana-ai/zcc-server/services/extensions/plugins', () => ({ listPlugins: vi.fn(), revealPlugin: vi.fn(), setPluginEnabled: vi.fn() }));
vi.mock('./plugin-apps-loopback.js', () => ({ getPluginSettingsFromProductServer: vi.fn() }));
import { getPluginSettingsFromProductServer } from './plugin-apps-loopback.js';
import { registerPluginsIpc } from './plugins.js';

const snapshot = () => ({
  descriptors: { token: { type: 'string', label: 'Token', secret: true }, relay: { type: 'string', label: 'Relay' } },
  values: { token: 'sekret', relay: 'https://r' }
});
const handlers = new Map<string, (...args: any[]) => any>();
const supervisor = { getPluginSettings: vi.fn() };

function bind(withSupervisor: boolean) {
  handlers.clear();
  bindIpcCtx({
    safeHandle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler),
    runtimeSupervisor: withSupervisor ? supervisor : undefined
  } as any);
  registerPluginsIpc();
}

beforeEach(() => {
  vi.clearAllMocks();
  supervisor.getPluginSettings.mockImplementation(async () => snapshot());
  vi.mocked(getPluginSettingsFromProductServer).mockImplementation(async () => snapshot() as any);
});

for (const [label, withSupervisor] of [['runtime supervisor', true], ['product-server fallback', false]] as const) {
  it(`getSettings via ${label}: redacts secrets only for { omitSecrets: true }`, async () => {
    bind(withSupervisor);
    const get = handlers.get(IPC.pluginApps.getSettings)!;
    const redacted = await get('p', { omitSecrets: true });
    expect(redacted.values).toEqual({ relay: 'https://r' });
    expect(redacted.descriptors.token).toBeDefined();
    for (const options of [undefined, {}, { omitSecrets: false }, { omitSecrets: 'true' }]) {
      expect((await get('p', options)).values).toEqual({ token: 'sekret', relay: 'https://r' });
    }
    expect(withSupervisor ? supervisor.getPluginSettings : getPluginSettingsFromProductServer).toHaveBeenCalledWith('p');
  });
}
