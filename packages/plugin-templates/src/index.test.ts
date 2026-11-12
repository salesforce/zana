// @vitest-environment happy-dom
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@testing-library/react';
import { transformSync } from 'esbuild';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as pluginAppSdk from '@zana-ai/zcc-plugin-sdk/app';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp, renderSlot } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { clampPluginStarterKind, scaffoldPlugin } from './index.js';

const dirs: string[] = [];
afterEach(() => {
  cleanup();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Execute generated source against the current SDK without building its dist. */
function generatedModule<T>(source: string, loader: 'ts' | 'tsx'): T {
  const compiled = transformSync(source, { loader, format: 'cjs', jsx: 'automatic' }).code;
  const module = { exports: {} };
  const require = createRequire(import.meta.url);
  const imports: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    '@zana-ai/zcc-plugin-sdk/app': pluginAppSdk
  };
  new Function('require', 'module', 'exports', compiled)(
    (id: string) => id in imports ? imports[id] : require(id), module, module.exports
  );
  return module.exports as T;
}

describe('scaffoldPlugin', () => {
  it.each(['panel', 'main-panel', 'mcp-consumer', 'agent-preset'])('teaches %s live verification to every agent provider', async (kind) => {
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-live-guide-'));
    dirs.push(dest);
    await scaffoldPlugin({ targetDir: dest, id: 'verify', name: 'Verify', kind });
    const agents = readFileSync(join(dest, 'AGENTS.md'), 'utf8');
    expect(agents).toBe(readFileSync(join(dest, 'CLAUDE.md'), 'utf8'));
    expect(agents).toContain('LIVE_TEST.md');
    const recipe = readFileSync(join(dest, 'LIVE_TEST.md'), 'utf8');
    expect(recipe).toContain('zcc plugin dev --once');
    expect(recipe).toContain('ZCC_SERVER_URL');
    expect(recipe).toContain(kind === 'agent-preset' ? 'actual response' : 'already-open panel');
  });
  it('writes a package.json zcc plugin with a runnable app panel', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-scaffold-'));
    dirs.push(dest);
    const result = await scaffoldPlugin({
      targetDir: dest,
      id: 'hello-abcd',
      name: 'Hello',
      kind: 'panel'
    });
    expect(result.packageName).toBe('zcc-plugin-hello-abcd');
    const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')) as {
      name: string;
      zcc: { name: string; app?: string; server?: string; skills: string[] };
    };
    expect(pkg.name).toBe('zcc-plugin-hello-abcd');
    expect(pkg.zcc.name).toBe('Hello');
    expect(pkg.zcc.app).toBe('./app.tsx');
    expect(pkg.zcc.server).toBeUndefined();
    expect(pkg.zcc.skills).toEqual(['skills']);
    expect(readFileSync(join(dest, 'app.js'), 'utf8')).toContain('__zccPluginApp');
    expect(readFileSync(join(dest, 'app.test.js'), 'utf8')).toContain('collectTestPluginApp');
    expect(readFileSync(join(dest, 'CLAUDE.md'), 'utf8')).toContain('zcc plugin install .');
    expect(readFileSync(join(dest, 'README.md'), 'utf8')).toContain('zcc plugin install .');
    expect(readFileSync(join(dest, 'CLAUDE.md'), 'utf8')).not.toMatch(
      /zcc plugin install \.\s*\nthen `zcc plugin dev/
    );
    expect(readFileSync(join(dest, 'CLAUDE.md'), 'utf8')).not.toContain('extension.json');
    expect(readFileSync(join(dest, 'app.js'), 'utf8')).not.toMatch(/activate\s*\(/);
    expect(readFileSync(join(dest, 'skills', 'hello-abcd', 'SKILL.md'), 'utf8')).toMatch(/hello-abcd/);
  });

  it.each(['panel', 'main-panel'])('%s publishes page context and clears it on unmount', async (kind) => {
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-page-context-'));
    dirs.push(dest);
    await scaffoldPlugin({ targetDir: dest, id: 'context', name: 'Context', kind });
    const definition = generatedModule<{ default: unknown }>(readFileSync(join(dest, 'app.tsx'), 'utf8'), 'tsx');
    const app = collectTestPluginApp(definition.default, 'context');
    const slot = renderSlot(app.navPanels[0]!, { pluginId: 'context', subPath: '' }, {
      rpc: { list: () => [] }
    });
    const expected = kind === 'main-panel'
      ? { title: 'Todo list', view: 'list', mention: { providerId: 'page', itemId: 'todos' } }
      : { title: 'Context', view: 'main' };
    expect(slot.inspection.navigateCalls).toContainEqual({ method: 'setPageContext', context: expected });
    expect(slot.inspection.navigateCalls.some(call => call.method === 'setPanelScope')).toBe(false);
    slot.unmount();
    expect(slot.inspection.navigateCalls.at(-1)).toEqual({ method: 'setPageContext', context: null });
    const instructions = readFileSync(join(dest, 'AGENTS.md'), 'utf8');
    expect(instructions).toContain('setPageContext');
    expect(instructions).toContain('Publish list/settings/loading states');
    expect(instructions).toContain('preserves the page identity and retrieval reference for retries');
    expect(instructions).toContain('Content is fetched only when the agent calls `page_context_read');
    const recipe = readFileSync(join(dest, 'LIVE_TEST.md'), 'utf8');
    expect(recipe).toContain('observe the agent fetch it with `page_context_read` when needed');
    expect(recipe).toContain('a queued message retains its original resource identity/reference');
  });

  it('main-panel resolves canonical current todos and bounds page context', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-page-resolver-'));
    dirs.push(dest);
    await scaffoldPlugin({ targetDir: dest, id: 'context', name: 'Context', kind: 'main-panel' });
    const server = generatedModule<{ default: (zcc: ZccPluginApi) => Promise<void> }>(readFileSync(join(dest, 'server.ts'), 'utf8'), 'ts');
    const { zcc, harness } = createFakePluginHost({ pluginId: 'context' });
    const registerMentionProvider = vi.spyOn(zcc.ui, 'registerMentionProvider');
    await server.default(zcc);
    const provider = registerMentionProvider.mock.calls.find(([provider]) => provider.id === 'page')![0];
    await expect(provider.resolve('unknown')).rejects.toThrow('Unknown page');
    expect(await provider.resolve('todos')).toEqual({ context: JSON.stringify({ page: 'Todo list', count: 0, todos: [] }) });
    const added = await harness.callRpc('add', { title: 'Read current document' });
    expect(await provider.resolve('todos')).toEqual({
      context: JSON.stringify({ page: 'Todo list', count: 1, todos: [added] })
    });
    await zcc.storage.kv.set('todos', Array.from({ length: 101 }, (_, i) => ({ id: String(i), title: 'x'.repeat(1_000), done: false })));
    const snapshot = await provider.resolve('todos');
    const resolved = JSON.parse(snapshot.context) as { count: number; todos: Array<{ title: string }> };
    expect(resolved.count).toBe(101);
    expect(resolved.todos).toHaveLength(100);
    expect(resolved.todos.every(todo => todo.title.length === 300)).toBe(true);
    expect(snapshot.context.length).toBeLessThan(60_000);
  });

  it('clamps unknown kinds to panel and does not clobber edits', async () => {
    expect(clampPluginStarterKind('evil')).toBe('panel');
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-scaffold-'));
    dirs.push(dest);
    await scaffoldPlugin({ targetDir: dest, id: 'x', name: 'X', kind: 'panel' });
    const marker = '// edited';
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dest, 'app.js'), marker);
    await scaffoldPlugin({ targetDir: dest, id: 'x', name: 'X', kind: 'panel' });
    expect(readFileSync(join(dest, 'app.js'), 'utf8')).toBe(marker);
  });

  it('scaffolds mcpServers on the mcp-consumer kind', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-scaffold-'));
    dirs.push(dest);
    await scaffoldPlugin({
      targetDir: dest,
      id: 'mcp-1',
      name: 'MCP',
      kind: 'mcp-consumer'
    });
    const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')) as {
      zcc: { mcpServers?: Record<string, unknown>; server?: string };
    };
    expect(pkg.zcc.server).toBe('./server.ts');
    expect(pkg.zcc.mcpServers).toBeTruthy();
    expect(readFileSync(join(dest, 'server.test.js'), 'utf8')).toContain('createFakePluginHost');
  });

  it('scaffolds a todos mini-app for main-panel', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-todos-'));
    dirs.push(dest);
    await scaffoldPlugin({
      targetDir: dest,
      id: 'hello-abcd',
      name: 'Hello',
      kind: 'main-panel'
    });
    const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')) as {
      scripts?: { test?: string };
      zcc: { app?: string; server?: string; branding?: { icon?: string } };
    };
    expect(pkg.zcc.app).toBe('./app.tsx');
    expect(pkg.zcc.server).toBe('./server.ts');
    expect(pkg.zcc.branding?.icon).toBe('ListTodo');
    expect(pkg.scripts?.test).toBe('vitest run');
    const server = readFileSync(join(dest, 'server.ts'), 'utf8');
    expect(server).toContain("zcc.rpc.method('list'");
    expect(server).toContain("zcc.rpc.method('add'");
    expect(server).toContain("zcc.rpc.method('toggle'");
    expect(server).toContain('cli.register');
    expect(server).toContain('showDone');
    const app = readFileSync(join(dest, 'app.tsx'), 'utf8');
    expect(app).toContain("from '@zana-ai/zcc-plugin-sdk/app'");
    expect(app).toContain('useRpc');
    expect(app).not.toContain('__ZCC_HOST_REACT__');
    expect(readFileSync(join(dest, 'server.test.ts'), 'utf8')).toContain('runCli');
    expect(readFileSync(join(dest, 'app.test.tsx'), 'utf8')).toContain('loadPluginApp');
    expect(readFileSync(join(dest, 'app.test.tsx'), 'utf8')).toContain('renderSlot');
    expect(readFileSync(join(dest, 'vitest.config.ts'), 'utf8')).toContain("environment: 'jsdom'");
    expect(readFileSync(join(dest, 'CLAUDE.md'), 'utf8')).toContain('npm test');
    expect(readFileSync(join(dest, 'CLAUDE.md'), 'utf8')).toContain('zcc plugin reload');
    expect(readFileSync(join(dest, 'README.md'), 'utf8')).toContain('zcc plugin install .');
    expect(readFileSync(join(dest, 'README.md'), 'utf8')).not.toMatch(
      /zcc plugin install \.\s*\nthen `zcc plugin dev/
    );
  });
});
