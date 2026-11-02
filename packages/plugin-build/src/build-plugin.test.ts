import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPlugin, buildPluginApp, buildPluginServer, syncPluginTypes } from './build-plugin.js';
import { getPluginBuildToolchain } from './toolchain.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('buildPluginApp', () => {
  it('rebuilds source siblings of published app and server entries with supplied tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-source-siblings-')); dirs.push(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'zcc-plugin-siblings', version: '0.1.0', zcc: { app: './app.js', server: './server.mjs' } }));
    writeFileSync(join(dir, 'app.js'), 'stale');
    writeFileSync(join(dir, 'app.tsx'), 'export default { freshPanel: true };');
    writeFileSync(join(dir, 'server.mjs'), 'stale');
    writeFileSync(join(dir, 'server.ts'), 'export default { freshBackend: true };');
    const tools = await getPluginBuildToolchain();
    const built = await buildPlugin(dir, '2.3.0', { toolchain: tools });
    expect(built.host).toBeNull();
    expect(readFileSync(built.app!.jsPath, 'utf8')).toContain('freshPanel');
    expect(readFileSync(built.server!.jsPath, 'utf8')).toContain('freshBackend');
  });

  it('skips absent legacy sources and reports stale or unchanged SDK declarations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-empty-plugin-')); dirs.push(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'zcc-plugin-empty', version: '0.1.0' }));
    expect(await buildPluginApp(dir, '2.3.0')).toBeNull();
    expect(await buildPluginServer(dir, '2.3.0')).toBeNull();
    expect(await syncPluginTypes(dir, { check: true })).toMatchObject([{ outcome: 'stale' }]);
    expect(await syncPluginTypes(dir)).toMatchObject([{ outcome: 'written' }]);
    expect(await syncPluginTypes(dir)).toMatchObject([{ outcome: 'unchanged' }]);
    expect(await syncPluginTypes(dir, { check: true })).toMatchObject([{ outcome: 'unchanged' }]);
  });
  it('builds the declared nested frontend and optional host, and skips a removed panel', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-declared-plugin-')); dirs.push(dir);
    mkdirSync(join(dir, 'src'));
    const pkg = { name: 'zcc-plugin-declared', version: '0.2.0', zcc: { app: './src/panel.tsx' as string | undefined, host: './host.ts' } };
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(dir, 'src/panel.tsx'), 'export default { declared: true };');
    writeFileSync(join(dir, 'host.ts'), 'export default {};');
    const built = await buildPlugin(dir, '2.3.0');
    expect(built.server).toBeNull();
    expect(built.app?.jsPath).toBe(join(dir, 'src/panel.js'));
    expect(built.host?.jsPath).toBe(join(dir, 'dist/host.js'));
    delete pkg.zcc.app;
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    expect(await buildPluginApp(dir, '2.3.0')).toBeNull();
  });

  it.each(['absolute', 'escape', 'symlink', 'missing'])('rejects a %s declared entry', async (kind) => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-entry-plugin-')); dirs.push(dir);
    const outside = mkdtempSync(join(tmpdir(), 'zcc-entry-outside-')); dirs.push(outside);
    writeFileSync(join(outside, 'panel.tsx'), 'export default {};');
    symlinkSync(join(outside, 'panel.tsx'), join(dir, 'linked.tsx'));
    const app = { absolute: join(outside, 'panel.tsx'), escape: '../escape.tsx', symlink: './linked.tsx', missing: './missing.tsx' }[kind]!;
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'zcc-plugin-path', version: '0.1.0', zcc: { app } }));
    await expect(buildPluginApp(dir, '2.3.0')).rejects.toThrow();
  });
  it('inlines CSS imports as text in the browser bundle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-css-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: '@zcc-ext/css-demo', version: '0.0.1' })
    );
    writeFileSync(join(dir, 'styles.css'), '.hello { color: red; }');
    writeFileSync(
      join(dir, 'app.tsx'),
      `import css from './styles.css';
export default { css, __zccPluginApp: true, setup() {} };
`
    );
    const result = await buildPluginApp(dir, '1.0.0');
    expect(result?.jsPath).toBe(join(dir, 'app.js'));
    const js = readFileSync(join(dir, 'app.js'), 'utf8');
    expect(js).toContain('.hello { color: red; }');
    expect(js).not.toMatch(/from ["']react["']/);
    expect(js).not.toMatch(/from ["']react\/jsx-runtime["']/);
  });

  it('shims react and jsx-runtime onto the host React global', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-react-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: '@zcc-ext/react-demo', version: '0.0.1' })
    );
    writeFileSync(
      join(dir, 'app.tsx'),
      `import { useState } from 'react';
import { jsx as _jsx } from 'react/jsx-runtime';
function Badge() {
  const [n] = useState(1);
  return _jsx('span', { children: n });
}
export default { Badge, __zccPluginApp: true, setup() {} };
`
    );
    const result = await buildPluginApp(dir, '1.0.0');
    expect(result?.jsPath).toBe(join(dir, 'app.js'));
    const js = readFileSync(join(dir, 'app.js'), 'utf8');
    expect(js).toContain('__ZCC_HOST_REACT__');
    expect(js).toContain('useState');
    expect(js).not.toMatch(/from ["']react["']/);
    expect(js).not.toMatch(/from ["']react\/jsx-runtime["']/);
    expect(js).not.toMatch(/from ["']react-dom["']/);
  });

  it('shims react-dom portal and flushSync onto the host react-dom global', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-react-dom-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: '@zcc-ext/react-dom-demo', version: '0.0.1' })
    );
    writeFileSync(
      join(dir, 'app.tsx'),
      `import { createPortal, flushSync } from 'react-dom';
export default { createPortal, flushSync, __zccPluginApp: true, setup() {} };
`
    );
    const result = await buildPluginApp(dir, '1.0.0');
    expect(result?.jsPath).toBe(join(dir, 'app.js'));
    const js = readFileSync(join(dir, 'app.js'), 'utf8');
    expect(js).toContain('__ZCC_HOST_REACT_DOM__');
    expect(js).toContain('createPortal');
    expect(js).toContain('flushSync');
    expect(js).not.toMatch(/from ["']react-dom["']/);
  });

  it('inlines @zana-ai/zcc-plugin-sdk/app so the renderer can import() the bundle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-sdk-app-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: '@zcc-ext/sdk-app-demo', version: '0.0.1' })
    );
    writeFileSync(
      join(dir, 'app.tsx'),
      `import { definePluginApp, callPluginRpc, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'main',
    title: 'Demo',
    icon: 'Box',
    component: function Panel() {
      useZccNavigate();
      return null;
    }
  });
  void callPluginRpc('demo', 'ping');
});
`
    );
    const result = await buildPluginApp(dir, '1.0.0');
    expect(result?.jsPath).toBe(join(dir, 'app.js'));
    const js = readFileSync(join(dir, 'app.js'), 'utf8');
    expect(js).not.toMatch(/from ["']@zana-ai\/zcc-plugin-sdk\/app["']/);
    expect(js).toContain('__ZCC_PLUGIN_HOST__');
    expect(js).toContain('__ZCC_PLUGIN_RUNTIME__');
    expect(js).toContain('__zccPluginApp');
  });

  it('writes an unminified sourcemap when requested for live reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-dev-map-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: '@zcc-ext/map-demo', version: '0.0.1' })
    );
    writeFileSync(
      join(dir, 'app.tsx'),
      `export default { __zccPluginApp: true, setup() { const readableName = 1; return readableName; } };
`
    );
    const result = await buildPluginApp(dir, '1.0.0', { minify: false, sourcemap: true });
    expect(result?.jsPath).toBe(join(dir, 'app.js'));
    const js = readFileSync(join(dir, 'app.js'), 'utf8');
    expect(js).toContain('readableName');
    expect(js).toContain('sourceMappingURL=app.js.map');
    expect(readFileSync(join(dir, 'app.js.map'), 'utf8')).toMatch(/app\.tsx/);
  });
});

describe('buildPluginServer', () => {
  it('bundles SDK app helpers so the backend loads without plugin node_modules', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-server-sdk-app-')); dirs.push(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'zcc-plugin-server-sdk-app', version: '0.1.0', zcc: { server: './server.ts' } }));
    writeFileSync(join(dir, 'server.ts'), `import { MAX_CONTEXT_REFERENCE_TEXT } from '@zana-ai/zcc-plugin-sdk/app';
export default function plugin() { return MAX_CONTEXT_REFERENCE_TEXT; }
`);
    const result = await buildPluginServer(dir, '2.5.1');
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `const { default: plugin } = await import(${JSON.stringify(pathToFileURL(result!.jsPath).href)}); process.stdout.write(String(plugin()));`], { encoding: 'utf8' });
    expect(output).toBe('100000');
  });

  it('keeps only the exact host-provided SDK entries external', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-server-sdk-externals-')); dirs.push(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'zcc-plugin-server-sdk-externals', version: '0.1.0', zcc: { server: './server.ts' } }));
    writeFileSync(join(dir, 'server.ts'), `export { defineRpcContract } from '@zana-ai/zcc-plugin-sdk';
export { normalizePluginDatabaseBackupOptions } from '@zana-ai/zcc-plugin-sdk/server';
export { MAX_CONTEXT_REFERENCE_TEXT } from '@zana-ai/zcc-plugin-sdk/app';
`);
    const result = await buildPluginServer(dir, '2.5.1');
    const js = readFileSync(result!.jsPath, 'utf8');
    expect(js).toMatch(/from\s*["']@zana-ai\/zcc-plugin-sdk["']/);
    expect(js).toMatch(/from\s*["']@zana-ai\/zcc-plugin-sdk\/server["']/);
    expect(js).not.toContain('@zana-ai/zcc-plugin-sdk/app');
  });

  it('preserves an already compiled backend without an editable source sibling', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-prebuilt-backend-')); dirs.push(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'zcc-plugin-prebuilt', version: '0.1.0', zcc: { server: './server.mjs' } }));
    const backend = 'export default () => "prebuilt";\n';
    writeFileSync(join(dir, 'server.mjs'), backend);
    expect(await buildPluginServer(dir, '2.3.0')).toBeNull();
    expect(await buildPluginServer(dir, '2.3.0')).toBeNull();
    expect(readFileSync(join(dir, 'server.mjs'), 'utf8')).toBe(backend);
  });
  it('shims CJS require so bundled Ajv-style deps can load in ESM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-server-cjs-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: '@zcc-ext/cjs-demo', version: '0.0.1' })
    );
    writeFileSync(
      join(dir, 'fs-dep.cjs'),
      `const fs = require('fs');
module.exports = { ok: typeof fs.readFileSync === 'function' };
`
    );
    writeFileSync(
      join(dir, 'server.ts'),
      `import dep from './fs-dep.cjs';
export default function plugin() {
  return dep.ok;
}
`
    );
    const result = await buildPluginServer(dir, '1.0.0');
    expect(result?.jsPath).toBe(join(dir, 'server.mjs'));
    const js = readFileSync(join(dir, 'server.mjs'), 'utf8');
    expect(js).toContain('createRequire as __createRequire');
    const loaded = (await import(`${pathToFileURL(result!.jsPath).href}?t=${Date.now()}`)) as {
      default: () => boolean;
    };
    expect(loaded.default()).toBe(true);
  });
});
