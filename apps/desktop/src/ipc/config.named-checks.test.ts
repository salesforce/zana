import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { registerConfigIpc } from './config.js';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  product: new Map<string, (...args: any[]) => any>(),
  mainFrame: {},
  sender: { mainFrame: {} as object, getURL: () => 'http://127.0.0.1:5173/' },
  get: vi.fn(() => []), set: vi.fn(async (_scope, checks) => checks),
  setProject: vi.fn(), setConfig: vi.fn(), safeSend: vi.fn()
}));
vi.mock('electron', () => ({ dialog: {}, ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => h.handlers.set(channel, handler) } }));
vi.mock('./shared-product-registration.js', () => ({
  productHandle: (channel: string, handler: (...args: any[]) => any) => h.product.set(channel, handler),
  safeProductHandle: (channel: string, handler: (...args: any[]) => any) => h.product.set(channel, handler)
}));
vi.mock('./ctx.js', () => ({ ctx: {
  safeHandle: vi.fn(), mainWindow: () => ({ webContents: h.sender }), safeSend: h.safeSend,
  localProjects: () => [{ id: 'p1' }]
} }));
vi.mock('./shared.js', () => ({ harnessVerifyState: {} }));
vi.mock('../window/renderer-url.js', () => ({ rendererUrl: () => 'http://127.0.0.1:5173/', isTrustedRendererUrl: (url: string) => url === 'http://127.0.0.1:5173/' }));
vi.mock('@zana-ai/zcc-server/http/public-app-url', () => ({ presentAppConfig: (config: unknown) => config }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: {
  getConfig: () => ({}), setConfig: h.setConfig, setProjectSettings: h.setProject
} }));
beforeEach(() => {
  h.handlers.clear(); h.product.clear(); vi.clearAllMocks();
  h.sender.mainFrame = h.mainFrame;
  registerConfigIpc({ get: h.get, set: h.set });
});
const event = () => ({ sender: h.sender, senderFrame: h.mainFrame });

it('registers dedicated owner channels, not shared product commands', async () => {
  expect(h.handlers.has('namedChecks:set')).toBe(true);
  expect(h.product.has('namedChecks:set')).toBe(false);
  const checks = [{ name: 'test', command: 'pnpm test' }];
  expect(await h.handlers.get('namedChecks:set')!(event(), { kind: 'global' }, checks)).toEqual(checks);
  expect(h.set).toHaveBeenCalledWith({ kind: 'global' }, checks);
  expect(await h.handlers.get('namedChecks:get')!(event(), { kind: 'project', projectId: 'p1' })).toEqual([]);
});

it('denies foreign windows, subframes, foreign origins and caller owner claims', async () => {
  expect(h.handlers.has('namedChecks:set')).toBe(true);
  const set = h.handlers.get('namedChecks:set')!;
  for (const ev of [
    { sender: { ...h.sender }, senderFrame: h.mainFrame },
    { sender: h.sender, senderFrame: {} },
    { sender: { ...h.sender, getURL: () => 'https://foreign.invalid' }, senderFrame: h.mainFrame }
  ]) await expect(set(ev, { kind: 'global' }, [{ name: 'test', command: 'bad' }], { owner: true })).rejects.toThrow('owner');
  await expect(set(event(), { kind: 'global', owner: true }, [])).rejects.toThrow();
  await expect(set(event(), { kind: 'project', projectId: 'foreign' }, [])).rejects.toThrow('registered');
  expect(h.set).not.toHaveBeenCalled();
});

it('rejects command lists through generic project and config patch paths', async () => {
  await expect(Promise.resolve().then(() => h.product.get(IPC.projectSettings.set)!('p1', { namedChecks: [{ name: 'test', command: 'bad' }] }))).rejects.toThrow();
  expect(() => h.product.get(IPC.config.set)!({ namedChecks: [{ name: 'test', command: 'bad' }] })).toThrow();
  expect(h.setProject).not.toHaveBeenCalled();
  expect(h.setConfig).not.toHaveBeenCalled();
});

it('propagates persistence errors and publishes only after successful writes', async () => {
  expect(h.handlers.has('namedChecks:set')).toBe(true);
  h.set.mockRejectedValueOnce(new Error('disk full'));
  await expect(h.handlers.get('namedChecks:set')!(event(), { kind: 'global' }, [])).rejects.toThrow('disk full');
  expect(h.safeSend).not.toHaveBeenCalled();
});
