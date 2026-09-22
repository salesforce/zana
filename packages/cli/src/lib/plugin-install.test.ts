import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPluginCommand } from './plugin-commands.js';
import { callControlPlane, isAppRunning } from './control-client.js';

vi.mock('./control-client.js', () => ({
  isAppRunning: vi.fn(() => true),
  callControlPlane: vi.fn(async () => ({ ok: true, value: { id: 'example' } }))
}));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
  vi.mocked(isAppRunning).mockReturnValue(true);
});
function fixture(app?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'zcc-install-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'zcc-plugin-example', version: '0.1.0', zcc: { app }
  }));
  return root;
}

describe('plugin path install', () => {
  it.each(['.', 'path:.'])('resolves %s in the CLI working directory', async (source) => {
    const root = fixture();
    const previous = process.cwd();
    process.chdir(root);
    try {
      expect((await runPluginCommand('/data', 'install', [source], false)).exitCode).toBe(0);
      expect(callControlPlane).toHaveBeenCalledWith({
        dataDir: '/data', op: 'plugin.install', args: { source: `path:${realpathSync(root)}` }
      });
    } finally { process.chdir(previous); }
  });

  it('compiles the frontend before requesting an install', async () => {
    const root = fixture('./app.tsx');
    writeFileSync(join(root, 'app.tsx'), 'export default { __zccPluginApp: true, setup() {} };');
    expect((await runPluginCommand('/data', 'install', [root], false)).exitCode).toBe(0);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(root, 'app.js'), 'utf8')).toContain('__zccPluginApp');
    expect(callControlPlane).toHaveBeenCalledOnce();
  });

  it('does not install a broken frontend', async () => {
    const root = fixture('./app.tsx');
    writeFileSync(join(root, 'app.tsx'), 'export default <broken');
    const result = await runPluginCommand('/data', 'install', [root], false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Plugin preparation failed');
    expect(callControlPlane).not.toHaveBeenCalled();
  });

  it('does not compile while the app is unavailable', async () => {
    vi.mocked(isAppRunning).mockReturnValue(false);
    const result = await runPluginCommand('/data', 'install', ['.'], false);
    expect(result.stderr).toContain('APP_NOT_RUNNING');
    expect(callControlPlane).not.toHaveBeenCalled();
  });

  it('rejects an empty explicit path', async () => {
    expect((await runPluginCommand('/data', 'install', ['path:'], false)).exitCode).toBe(2);
    expect(callControlPlane).not.toHaveBeenCalled();
  });

  it.each(['builtin:tasks', 'tasks', 'npm:example', 'git:https://example.com/plugin', 'example@store'])(
    'preserves non-path source %s', async (source) => {
      expect((await runPluginCommand('/data', 'install', [source], false)).exitCode).toBe(0);
      expect(callControlPlane).toHaveBeenCalledWith({ dataDir: '/data', op: 'plugin.install', args: { source } });
    }
  );
});
