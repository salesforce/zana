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
    expect(pkg.zcc.app).toBe('./app.js');
    expect(pkg.zcc.server).toBeUndefined();
    expect(pkg.zcc.skills).toEqual(['skills']);
    expect(readFileSync(join(dest, 'app.js'), 'utf8')).toContain('__zccPluginApp');
    expect(readFileSync(join(dest, 'app.test.js'), 'utf8')).toContain('collectTestPluginApp');
    expect(readFileSync(join(dest, 'CLAUDE.md'), 'utf8')).toContain('zcc plugin dev');
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
    expect(pkg.zcc.server).toBe('./server.mjs');
    expect(pkg.zcc.mcpServers).toBeTruthy();
    expect(readFileSync(join(dest, 'server.test.js'), 'utf8')).toContain('createFakePluginHost');
  });
});
