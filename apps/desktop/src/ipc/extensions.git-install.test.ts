import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindIpcCtx } from './ctx.js';

vi.mock('electron', () => ({ ipcMain: {}, BrowserWindow: { getFocusedWindow: () => null }, dialog: {}, shell: {} }));
vi.mock('./shared-product-registry.js', () => ({ registerSharedProduct() {} }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [] }, scratchWorkspaceRoot: () => '/unused', worktreeRoot: () => '/unused' }));
vi.mock('@zana-ai/zcc-server/services/projects/git-clone', () => ({ cloneProject: vi.fn() }));
vi.mock('@zana-ai/zcc-server/services/extensions/extension-installer', async original => ({
  ...await original<typeof import('@zana-ai/zcc-server/services/extensions/extension-installer')>(), installFromDir: vi.fn()
}));
import { cloneProject } from '@zana-ai/zcc-server/services/projects/git-clone';
import { installFromDir } from '@zana-ai/zcc-server/services/extensions/extension-installer';
import { registerExtensionsIpc } from './extensions.js';

let root = '';
const installPlugin = vi.fn();
const handlers = new Map<string, (...args: any[]) => any>();
const url = 'https://example.test/plugins.git';
function bind(attached = true) {
  bindIpcCtx({ safeHandle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler),
    runtimeSupervisor: attached ? { installPlugin } : undefined, mainWindow: () => null,
    extensionEntries: [], builtinIds: new Set(), safeSend() {}, logMainError() {}
  } as any);
  registerExtensionsIpc();
}
async function manifest(subdir = '', id = 'fixture') {
  const dir = join(root, subdir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `zcc-plugin-${id}`, version: '1.0.0',
    zcc: { name: id, description: 'Git install fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  await writeFile(join(dir, 'server.mjs'), 'export default () => {};');
}
const install = (input: Record<string, unknown> = {}) => handlers.get(IPC.extensions.install)!({ kind: 'git', url, ...input });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ipc-git-plugin-'));
  vi.resetAllMocks(); handlers.clear();
  vi.mocked(cloneProject).mockResolvedValue({ ok: true, path: root } as any);
  installPlugin.mockResolvedValue({ id: 'fixture' });
  bind();
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it.each([
  ['', {}, `git:${url}@HEAD`],
  ['plugin folder', { subdir: 'plugin folder', ref: 'feature/test' }, `git:${url}@feature/test#subdir=plugin%20folder`],
  ['discovered', {}, `git:${url}@HEAD#subdir=discovered`]
])('retains the remote source and selected subtree (%s)', async (subdir, input, source) => {
  await manifest(subdir);
  await expect(install(input)).resolves.toEqual({ ok: true, value: { id: 'fixture' } });
  expect(installPlugin).toHaveBeenCalledExactlyOnceWith(source);
});

it('refuses remote code claiming a bundled identity before forwarding to the runtime', async () => {
  await manifest('', 'docs');
  await expect(install()).rejects.toThrow(/reserved/);
  expect(installPlugin).not.toHaveBeenCalled();
});

it('reports an unavailable runtime after validating the remote manifest', async () => {
  await manifest(); bind(false);
  await expect(install()).resolves.toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(installPlugin).not.toHaveBeenCalled();
});

it.each([null, 'fixture', {}, { id: '' }])('reports a failed install when the runtime returns no identity: %o', async row => {
  await manifest(); installPlugin.mockResolvedValueOnce(row);
  await expect(install()).resolves.toMatchObject({ ok: false, code: 'INSTALL_FAILED' });
});

it('propagates runtime install errors without changing the source kind', async () => {
  await manifest(); installPlugin.mockRejectedValueOnce(new Error('activation failed'));
  await expect(install()).rejects.toThrow('activation failed');
  expect(installPlugin).toHaveBeenCalledExactlyOnceWith(`git:${url}@HEAD`);
});

it('keeps legacy manifests on the consent-aware extension installer', async () => {
  await writeFile(join(root, 'extension.json'), JSON.stringify({ id: 'legacy' }));
  const result = { ok: false as const, code: 'NEEDS_CONSENT', message: 'Operator consent required' };
  vi.mocked(installFromDir).mockResolvedValueOnce(result);
  await expect(install()).resolves.toEqual(result);
  expect(installFromDir).toHaveBeenCalledOnce();
  expect(installPlugin).not.toHaveBeenCalled();
});
