import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

describe('OpenCode agent discovery startup warmup', () => {
  it('warms registered local project catalogs after IPC registration without blocking bootstrap', () => {
    const ipc = source.indexOf('registerIpc();');
    const scratch = source.indexOf('store.ensureQuickAgentProject();', ipc);
    const warmup = source.indexOf("const openCodeProvider = providerFor('opencode');");
    const scheduler = source.indexOf('scheduler.setDeps({');
    expect(ipc).toBeGreaterThan(-1);
    expect(scratch).toBeGreaterThan(ipc);
    expect(warmup).toBeGreaterThan(ipc);
    expect(warmup).toBeGreaterThan(scratch);
    expect(scheduler).toBeGreaterThan(warmup);
    expect(source.slice(warmup, scheduler)).toContain('if (project.remote) continue;');
    expect(source.slice(warmup, scheduler)).toContain('void openCodeProvider.discoverAgentDescriptors({');
  });
});
