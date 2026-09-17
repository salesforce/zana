import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ipcSource = readFileSync(new URL('../../../../packages/desktop-contract/src/ipc.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../preload.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../ipc/extensions.ts', import.meta.url), 'utf8');

describe('marketplace catalog list IPC', () => {
  it('reads the marketplace store from main and exposes it on preload', () => {
    expect(ipcSource).toContain("list: 'marketplaces:list'");
    expect(preloadSource).toContain(
      'list: () => ipcRenderer.invoke(IPC.marketplaces.list)'
    );
    expect(mainSource).toContain('IPC.marketplaces.list');
    expect(mainSource).toContain('listPublicMarketplaceCatalogs(defaultPluginDataDir())');
  });
});
