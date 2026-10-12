import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginServiceOptions } from '../plugins/plugin-service.js';
import { createAttachedProductPluginService } from './product-plugins.js';
import { startProductServer, type ProductServer } from './product-server.js';

const captured = vi.hoisted(() => ({ options: null as PluginServiceOptions | null }));
vi.mock('../plugins/plugin-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../plugins/plugin-service.js')>();
  return {
    ...actual,
    createPluginService: (options: PluginServiceOptions) => {
      captured.options = options;
      return actual.createPluginService(options);
    }
  };
});

let server: ProductServer | null = null;
const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-product-plugins-approval-'));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  await server?.close();
  server = null;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('plugin approvals on the product server', () => {
  it('redeems a token only through the desktop verifier', async () => {
    server = await startProductServer({ dataDir: tempDir(), origins: { serverPort: 0, devAppPort: 5173 } });
    createAttachedProductPluginService(server.ctx, { bundledRoot: tempDir() });
    const consume = captured.options!.consumePluginApproval!;
    const binding = { action: 'agent.publish', target: 'org', targetLabel: 'dev', subject: 'Bot' };

    const verify = vi.fn(() => true);
    server.ctx.verifyPluginApproval = verify;
    expect(await consume({ pluginId: 'salesforce', token: 't', binding })).toBe(true);
    expect(verify).toHaveBeenCalledWith('t', 'salesforce', binding);

    // Web and headless servers have no desktop signer, so nothing redeems.
    server.ctx.verifyPluginApproval = undefined;
    expect(await consume({ pluginId: 'salesforce', token: 't', binding })).toBe(false);
  });
});
