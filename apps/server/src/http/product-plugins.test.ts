import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { attachProductPluginService } from './product-plugins.js';
import { startProductServer, type ProductServer } from './product-server.js';
import { getThreadProvider } from '../services/threads/thread-provider-catalog.js';

let server: ProductServer | null = null;
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-product-plugins-attach-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  const plugins = server?.ctx.plugins;
  if (plugins) {
    for (const row of plugins.list()) {
      await plugins.remove(row.id).catch(() => undefined);
    }
  }
  await server?.close();
  server = null;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeProviderPlugin(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'zcc-plugin-provider-acp',
      version: '0.1.0',
      engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: {
        name: 'ACP providers',
        description: 'ACP thread providers',
        branding: { icon: 'Puzzle' },
        server: './server.mjs'
      }
    })
  );
  writeFileSync(
    join(dir, 'server.mjs'),
    `export default function plugin(zcc) {
      zcc.agents.experimental_registerProvider({
        id: 'acp-opencode',
        displayName: 'OpenCode',
        capabilities: {
          supportsServiceTier: true,
          fork: 'tip',
          supportsManualCompaction: true,
          supportsThreadArchive: false,
          supportsThreadRename: false,
          permissionModes: ['accept-edits', 'full']
        },
        composerActions: []
      });
    }\n`
  );
}

describe('attachProductPluginService', () => {
  it('starts bundled plugins so thread create can resolve acp-opencode', async () => {
    const dataDir = tempDir();
    const bundled = tempDir();
    writeProviderPlugin(join(bundled, 'provider-acp'));
    server = await startProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    await attachProductPluginService(server.ctx, { bundledRoot: bundled });
    expect(getThreadProvider('acp-opencode')?.displayName).toBe('OpenCode');
    expect(server.ctx.plugins?.get('provider-acp')?.status).toBe('running');
  });
});

describe('listen.ts', () => {
  it('starts the plugin service on the standalone product server', () => {
    const source = readFileSync(new URL('./listen.ts', import.meta.url), 'utf8');
    expect(source).toContain('attachProductPluginService(host.ctx)');
  });
});
