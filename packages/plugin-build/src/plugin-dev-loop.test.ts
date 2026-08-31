import { describe, expect, it } from 'vitest';
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
    await new Promise((resolve) => setTimeout(resolve, 20));
    await loop.settled();
    expect(reloads).toEqual(['ok']);
    loop.dispose();
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
