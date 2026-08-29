import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPluginApp } from './build-plugin.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('buildPluginApp', () => {
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

  it('inlines @zana-ai/zcc-plugin-sdk/app so the renderer can import() the bundle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-sdk-app-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: '@zcc-ext/sdk-app-demo', version: '0.0.1' })
    );
    writeFileSync(
      join(dir, 'app.tsx'),
      `import { definePluginApp, callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'main',
    title: 'Demo',
    icon: 'Box',
    component: () => null
  });
  void callPluginRpc;
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
});
