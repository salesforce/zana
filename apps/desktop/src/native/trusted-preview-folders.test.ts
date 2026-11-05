import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addPickedTrustedPreviewFolder, removeStoredTrustedPreviewFolder } from './trusted-preview-folders.js';

let base: string;
let config: { trustedPreviewFolders?: string[] };
const deps = () => ({
  getConfig: () => config as never,
  setConfig: vi.fn((patch: { trustedPreviewFolders?: string[] }) => { config = { ...config, ...patch }; return config as never; })
});
beforeEach(async () => { base = await realpath(await mkdtemp(join(tmpdir(), 'trusted-native-'))); config = {}; });
afterEach(() => rm(base, { recursive: true, force: true }));

describe('addPickedTrustedPreviewFolder', () => {
  it('persists the real directory of a pick', async () => {
    const d = deps();
    await expect(addPickedTrustedPreviewFolder(base, d)).resolves.toEqual({ trustedPreviewFolders: [base] });
    expect(d.setConfig).toHaveBeenCalledWith({ trustedPreviewFolders: [base] });
  });
  it('trusts the symlink target, not the link', async () => {
    const target = join(base, 'target'); await mkdir(target);
    const link = join(base, 'link'); await symlink(target, link, 'dir');
    await addPickedTrustedPreviewFolder(link, deps());
    expect(config.trustedPreviewFolders).toEqual([target]);
  });
  it('rejects files, missing paths and filesystem root without writing', async () => {
    const d = deps();
    const file = join(base, 'f.txt'); await writeFile(file, 'x');
    await expect(addPickedTrustedPreviewFolder(file, d)).rejects.toThrow('Choose a folder.');
    await expect(addPickedTrustedPreviewFolder(join(base, 'gone'), d)).rejects.toThrow();
    await expect(addPickedTrustedPreviewFolder('/', d)).rejects.toThrow(/canonical absolute/);
    expect(d.setConfig).not.toHaveBeenCalled();
  });
  it('fails closed at the cap and keeps the existing list', async () => {
    config = { trustedPreviewFolders: Array.from({ length: 20 }, (_, i) => `/t/${i}`) };
    const d = deps();
    await expect(addPickedTrustedPreviewFolder(base, d)).rejects.toThrow(/At most 20/);
    expect(d.setConfig).not.toHaveBeenCalled();
    expect(config.trustedPreviewFolders).toHaveLength(20);
  });
  it('dedupes a repeat pick', async () => {
    const d = deps();
    await addPickedTrustedPreviewFolder(base, d);
    await addPickedTrustedPreviewFolder(base, d);
    expect(config.trustedPreviewFolders).toEqual([base]);
  });
});

describe('removeStoredTrustedPreviewFolder', () => {
  it('removes only the named entry', () => {
    config = { trustedPreviewFolders: ['/a', '/b'] };
    removeStoredTrustedPreviewFolder('/a', deps());
    expect(config.trustedPreviewFolders).toEqual(['/b']);
  });
  it('rejects non-canonical or non-string input without writing', () => {
    const d = deps();
    for (const bad of [undefined, 5, '', 'rel', '~/x', '/']) {
      expect(() => removeStoredTrustedPreviewFolder(bad, d)).toThrow('Unknown trusted folder.');
    }
    expect(d.setConfig).not.toHaveBeenCalled();
  });
  it('is a no-op for an unlisted folder', () => {
    config = { trustedPreviewFolders: ['/a'] };
    removeStoredTrustedPreviewFolder('/zzz', deps());
    expect(config.trustedPreviewFolders).toEqual(['/a']);
  });
});
