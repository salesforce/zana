import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { registerProjectsIpc } from './projects.js';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  updateLocal: vi.fn(), updateRuntime: vi.fn(), listRuntime: vi.fn(), send: vi.fn(),
  runtime: null as any
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, dialog: {} }));
vi.mock('./ctx.js', () => ({ ctx: {
  safeHandle: (channel: string, handler: (...args: any[]) => any) => h.handlers.set(channel, handler),
  get runtimeSupervisor() { return h.runtime; }, safeSend: h.send
} }));
vi.mock('./shared-product-registration.js', () => ({ productHandle: vi.fn(), safeProductHandle: vi.fn() }));
vi.mock('../extensions/ssh-host-provider-registry.js', () => ({ asSshHosts: vi.fn(), asSshSyncResult: vi.fn(), mergeSshHosts: vi.fn() }));
vi.mock('@zana-ai/zcc-host-daemon/mcp-config', () => ({ ensureMcpConfigForProject: vi.fn() }));
vi.mock('@zana-ai/zcc-server/services/projects/ssh-config', () => ({ parseSshConfig: vi.fn() }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { updateProject: h.updateLocal } }));

beforeEach(() => {
  vi.clearAllMocks(); h.handlers.clear();
  h.updateLocal.mockImplementation((id, patch) => ({ id, ...patch }));
  h.updateRuntime.mockImplementation(async (id, patch) => ({ id, ...patch }));
  h.listRuntime.mockResolvedValue([{ id: 'project' }]);
  h.runtime = { updateProject: h.updateRuntime, listProjects: h.listRuntime };
  registerProjectsIpc();
});
const update = (patch: object) => h.handlers.get(IPC.projects.update)!('project', patch);

describe('project thread-default IPC routing', () => {
  it.each(['custom-provider', null])('persists %s through the project configuration owner even with an active runtime', async value => {
    expect(await update({ defaultThreadProviderId: value })).toEqual({ id: 'project', defaultThreadProviderId: value });
    expect(h.updateLocal).toHaveBeenCalledWith('project', { defaultThreadProviderId: value });
    expect(h.updateRuntime).not.toHaveBeenCalled();
  });
  it('keeps ordinary project edits on the runtime and broadcasts its result', async () => {
    expect(await update({ name: 'Renamed' })).toEqual({ id: 'project', name: 'Renamed' });
    expect(h.updateRuntime).toHaveBeenCalledWith('project', { name: 'Renamed' });
    expect(h.send).toHaveBeenCalledWith(IPC.projects.onChanged, [{ id: 'project' }]);
    expect(h.updateLocal).not.toHaveBeenCalled();
  });
  it('preserves local routing without a runtime and propagates persistence failures', async () => {
    h.runtime = null;
    expect(await update({ name: 'Local' })).toEqual({ id: 'project', name: 'Local' });
    h.updateLocal.mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    await expect(update({ defaultThreadProviderId: null })).rejects.toThrow('disk unavailable');
  });
});
