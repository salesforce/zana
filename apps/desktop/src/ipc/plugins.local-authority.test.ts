import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { localMetadataProjects, localProjectPathOptions } from '@zana-ai/zcc-server/services/projects/project-metadata';
import { bindIpcCtx } from './ctx.js';

vi.mock('electron', () => ({ ipcMain: {} }));
vi.mock('@zana-ai/zcc-server/services/mcp/mcp', () => ({ listMcpServers: vi.fn(), setMcpServerEnabled: vi.fn() }));
vi.mock('@zana-ai/zcc-server/services/mcp/mcp-catalogue', () => ({ listMcpServersAll: vi.fn(), setMcpServerEnabledById: vi.fn(), revealMcpServer: vi.fn() }));
vi.mock('@zana-ai/zcc-server/services/extensions/plugins', () => ({ listPlugins: vi.fn(), revealPlugin: vi.fn(), setPluginEnabled: vi.fn() }));
vi.mock('./plugin-apps-loopback.js', () => ({}));
import { listMcpServers, setMcpServerEnabled } from '@zana-ai/zcc-server/services/mcp/mcp';
import { listMcpServersAll, setMcpServerEnabledById, revealMcpServer } from '@zana-ai/zcc-server/services/mcp/mcp-catalogue';
import { registerPluginsIpc } from './plugins.js';

const projects = [{ id: 'local', path: '/local', hostId: 'primary' }, { id: 'foreign', path: '/foreign', hostId: 'secondary' }] as any;
const handlers = new Map<string, (...args: any[]) => any>();
const emitMcpChanged = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); handlers.clear();
  bindIpcCtx({
    safeHandleFromWindow: vi.fn(),
    safeHandle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler),
    localProjects: () => localMetadataProjects(projects, 'primary'),
    projectPathToOptions: (path?: string) => localProjectPathOptions(projects, 'primary', path),
    emitMcpChanged,
  } as any);
  registerPluginsIpc();
});

it('rejects foreign, unregistered and missing paths before local MCP reads or writes', async () => {
  for (const path of ['/foreign', '/unknown', undefined]) {
    expect(() => handlers.get(IPC.mcp.list)!(path)).toThrow();
    expect(() => handlers.get(IPC.mcp.setEnabled)!(path, 'server', false)).toThrow();
  }
  expect(listMcpServers).not.toHaveBeenCalled(); expect(setMcpServerEnabled).not.toHaveBeenCalled();
  await handlers.get(IPC.mcp.list)!('/local');
  await handlers.get(IPC.mcp.setEnabled)!('/local', 'server', false);
  expect(listMcpServers).toHaveBeenCalledWith('/local');
  expect(setMcpServerEnabled).toHaveBeenCalledWith('/local', 'server', false);
});

it('grants catalog listing, toggles and reveal only the local project registry', async () => {
  await handlers.get(IPC.mcp.listAll)!();
  vi.mocked(setMcpServerEnabledById).mockResolvedValueOnce({ ok: true, value: true });
  await handlers.get(IPC.mcp.setEnabledById)!('project:local:server', false);
  expect(emitMcpChanged).toHaveBeenCalledOnce();
  vi.mocked(setMcpServerEnabledById).mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', message: 'missing' } as any);
  await handlers.get(IPC.mcp.setEnabledById)!('project:foreign:server', false);
  expect(emitMcpChanged).toHaveBeenCalledOnce();
  await handlers.get(IPC.mcp.reveal)!('project:foreign:server');
  expect(listMcpServersAll).toHaveBeenCalledWith([projects[0]]);
  expect(setMcpServerEnabledById).toHaveBeenLastCalledWith('project:foreign:server', false, [projects[0]]);
  expect(revealMcpServer).toHaveBeenCalledWith('project:foreign:server', [projects[0]]);
});
