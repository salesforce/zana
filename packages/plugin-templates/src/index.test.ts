import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clampPluginStarterKind, scaffoldPlugin } from './index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('scaffoldPlugin', () => {
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
