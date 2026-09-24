import { describe, expect, it, vi } from 'vitest';
import { createPluginDevLoop, isIgnoredPluginDevPath } from './plugin-dev-loop.js';
import { createPluginArtifactMeta } from './build-plugin.js';

describe('plugin dev loop', () => {
  it('ignores dist, node_modules, types, and generated artifact basenames', () => {
    expect(isIgnoredPluginDevPath('dist/app.js')).toBe(true);
    expect(isIgnoredPluginDevPath('node_modules/x')).toBe(true);
    expect(isIgnoredPluginDevPath('types/zcc-plugin-sdk.d.ts')).toBe(true);
    expect(isIgnoredPluginDevPath('app.js')).toBe(true);
    expect(isIgnoredPluginDevPath('app.js.map')).toBe(true);
    expect(isIgnoredPluginDevPath('app.meta.json')).toBe(true);
    expect(isIgnoredPluginDevPath('server.mjs')).toBe(true);
    expect(isIgnoredPluginDevPath('server.meta.json')).toBe(true);
    expect(isIgnoredPluginDevPath('app.tsx')).toBe(false);
    expect(isIgnoredPluginDevPath('server.ts')).toBe(false);
  });

  it('rebuilds then reloads, and skips reload when the build fails', async () => {
    const logs: string[] = [];
    const reloads: string[] = [];
    const loop = createPluginDevLoop({
      pluginId: 'hello',
      hasApp: true,
      hasServer: true,
      debounceMs: 1,
      buildServer: async () => undefined,
      buildApp: async () => {
        throw new Error('jsx');
      },
      reloadPlugin: async () => {
        reloads.push('reload');
      },
      log: (line) => logs.push(line)
    });
    loop.handleChange('app.tsx');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await loop.settled();
    expect(reloads).toEqual([]);
    expect(logs.join('\n')).toMatch(/app build failed/);
    loop.dispose();
  });

  it('reloads after a successful rebuild', async () => {
    const reloads: string[] = [];
    const loop = createPluginDevLoop({
      pluginId: 'hello',
      hasApp: false,
      hasServer: true,
      debounceMs: 1,
      buildServer: async () => undefined,
      buildApp: async () => undefined,
      reloadPlugin: async () => {
        reloads.push('ok');
      },
      log: () => undefined
    });
    loop.handleChange('server.ts');
    await loop.flushNow();
    expect(reloads).toEqual(['ok']);
    loop.dispose();
  });

  it('flushNow runs a pending cycle without waiting for debounce', async () => {
    const reloads: string[] = [];
    const loop = createPluginDevLoop({
      pluginId: 'hello',
      hasApp: false,
      hasServer: false,
      debounceMs: 60_000,
      buildServer: async () => undefined,
      buildApp: async () => undefined,
      reloadPlugin: async () => {
        reloads.push('ok');
      },
      log: () => undefined
    });
    loop.handleChange('package.json');
    await loop.flushNow();
    expect(reloads).toEqual(['ok']);
    loop.dispose();
  });

  it.each(['server', 'app', 'reload'] as const)('reports %s failures and recovers on the next save', async (stage) => {
    const order: string[] = [];
    let broken = true;
    const step = (name: string) => async () => {
      order.push(name);
      if (broken && name === stage) throw 'broken';
    };
    const loop = createPluginDevLoop({
      pluginId: 'hello', hasServer: true, hasApp: true,
      buildServer: step('server'), buildApp: step('app'), reloadPlugin: step('reload'),
      log: vi.fn(), now: () => 100
    });
    loop.handleChange('server.ts');
    expect(await loop.flushNow()).toEqual({ ok: false, stage, message: 'broken' });
    expect(order).toEqual(['server', 'app', 'reload'].slice(0, ['server', 'app', 'reload'].indexOf(stage) + 1));
    broken = false;
    loop.handleChange('server.ts');
    expect(await loop.flushNow()).toEqual({ ok: true });
    expect(order.slice(-3)).toEqual(['server', 'app', 'reload']);
    loop.dispose();
  });

  it('coalesces changes, serializes cycles, and cancels queued work on dispose', async () => {
    let finish!: () => void;
    const build = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const reload = vi.fn(async () => undefined);
    const logs: string[] = [];
    const loop = createPluginDevLoop({
      pluginId: 'hello', hasServer: false, hasApp: true,
      buildServer: async () => undefined, buildApp: build, reloadPlugin: reload,
      log: (line) => logs.push(line)
    });
    loop.handleChange('app.tsx');
    loop.handleChange('style.css');
    const first = loop.flushNow();
    await Promise.resolve();
    loop.handleChange('server.ts');
    const second = loop.flushNow();
    expect(build).toHaveBeenCalledTimes(1);
    loop.dispose();
    finish();
    expect(await first).toEqual({ ok: true });
    expect(await second).toBeNull();
    expect(build).toHaveBeenCalledTimes(1);
    expect(logs[0]).toContain('2 files changed');
    loop.handleChange('app.tsx');
    expect(await loop.flushNow()).toBeNull();
  });

  it('does not invent a cycle for ignored or cancelled changes', async () => {
    const reload = vi.fn(async () => undefined);
    const loop = createPluginDevLoop({
      pluginId: 'hello', hasServer: false, hasApp: false,
      buildServer: async () => undefined, buildApp: async () => undefined,
      reloadPlugin: reload, log: vi.fn()
    });
    loop.handleChange('dist/app.js');
    expect(await loop.flushNow()).toBeNull();
    loop.handleChange('app.tsx');
    loop.dispose();
    expect(await loop.flushNow()).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('plugin artifact meta', () => {
  it('stamps the SDK major and derived plugin id', () => {
    const meta = createPluginArtifactMeta({
      packageName: 'zcc-plugin-hello',
      pluginVersion: '1.0.0',
      zccVersion: '1.0.10'
    });
    expect(meta.pluginId).toBe('hello');
    expect(meta.sdkMajor).toBe(1);
    expect(meta.builtWith.zccVersion).toBe('1.0.10');
  });
});
