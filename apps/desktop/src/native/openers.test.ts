import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Every spawn is recorded; `failing` commands emit ENOENT like a missing binary.
// `/usr/bin/open -a <app>` exits 0 only for an app listed in `macApps`.
const h = vi.hoisted(() => ({
  spawns: [] as Array<{ cmd: string; args: string[]; opts: Record<string, unknown> }>,
  failing: new Set<string>(),
  exes: new Map<string, { exe: string; cliJs?: string }>(),
  macApps: new Set<string>()
}));
vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[], opts: Record<string, unknown>) => {
    h.spawns.push({ cmd, args, opts });
    const child = Object.assign(new EventEmitter(), { unref: vi.fn(), stderr: new EventEmitter() });
    queueMicrotask(() => {
      if (h.failing.has(cmd)) child.emit('error', Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: 'ENOENT' }));
      else if (cmd !== '/usr/bin/open') child.emit('spawn');
      else if (h.macApps.has(args[1])) child.emit('exit', 0);
      else {
        child.stderr.emit('data', `Unable to find application named '${args[1]}'`);
        child.emit('exit', 1);
      }
    });
    return child;
  }
}));
vi.mock('electron', () => ({ shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn(), openExternal: vi.fn(async () => {}) } }));
vi.mock('@zana-ai/zcc-server/services/projects/editor-windows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zana-ai/zcc-server/services/projects/editor-windows')>()),
  resolveWindowsEditorLaunch: async (_target: string, binary: string) => h.exes.get(binary) ?? null
}));

const { shell } = await import('electron');
const { openIn } = await import('./openers.js');

const realPlatform = process.platform;
function onPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

afterEach(() => {
  onPlatform(realPlatform);
  h.spawns = [];
  h.failing = new Set();
  h.exes = new Map();
  h.macApps = new Set();
});

describe('openIn editors on Windows', () => {
  it('runs Code.exe on its cli.js as Node, like the shim, with no shell', async () => {
    onPlatform('win32');
    const cliJs = 'C:\\Microsoft VS Code\\6d62b1d5da\\resources\\app\\out\\cli.js';
    h.exes.set('code', { exe: 'C:\\Microsoft VS Code\\Code.exe', cliJs });
    const result = await openIn('code', 'C:\\work\\my project & co');
    expect(result).toEqual({ ok: true });
    expect(h.spawns).toEqual([
      {
        cmd: 'C:\\Microsoft VS Code\\Code.exe',
        args: [cliJs, '-n', 'C:\\work\\my project & co'],
        opts: { detached: true, stdio: 'ignore', env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' }) }
      }
    ]);
    // The rest of the environment is inherited.
    expect(Object.keys(h.spawns[0].opts.env as object)).toEqual(expect.arrayContaining(Object.keys(process.env)));
  });

  it('passes a bare Code.exe just the path, since -n opens nothing in a running VS Code', async () => {
    onPlatform('win32');
    h.exes.set('code', { exe: 'E:\\VSC\\Code.exe' });
    await openIn('code', 'C:\\work');
    expect(h.spawns).toEqual([{ cmd: 'E:\\VSC\\Code.exe', args: ['C:\\work'], opts: { detached: true, stdio: 'ignore' } }]);
  });

  it('resolves the configured CLI launcher and passes IntelliJ just the path', async () => {
    onPlatform('win32');
    h.exes.set('D:\\IDEA\\bin\\idea.bat', { exe: 'D:\\IDEA\\bin\\idea64.exe' });
    await openIn('intellij', 'C:\\work', { intellijBinary: ' D:\\IDEA\\bin\\idea.bat ' });
    expect(h.spawns.map((s) => [s.cmd, s.args])).toEqual([['D:\\IDEA\\bin\\idea64.exe', ['C:\\work']]]);
  });

  it('reports a Windows install hint, without spawning, when the editor isn’t found', async () => {
    onPlatform('win32');
    const result = await openIn('cursor', 'C:\\work');
    expect(h.spawns).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      'Could not launch Cursor. Install it from cursor.com, or set its CLI launcher to the full path of Cursor.exe in Settings → Editor.'
    );
  });

  it('includes the spawn error when the resolved executable fails to start', async () => {
    onPlatform('win32');
    h.exes.set('code', { exe: 'C:\\VSC\\Code.exe' });
    h.failing.add('C:\\VSC\\Code.exe');
    const result = await openIn('code', 'C:\\work');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^Could not launch VS Code\. .*Code\.exe in Settings → Editor\. \(spawn C:\\VSC\\Code\.exe ENOENT\)$/);
  });
});

describe('openIn non-editor targets', () => {
  it('opens a folder in the file manager, reveals a file, and reports a missing path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-openers-'));
    try {
      writeFileSync(join(dir, 'notes.md'), '');
      expect(await openIn('finder', dir)).toEqual({ ok: true });
      expect(shell.openPath).toHaveBeenCalledWith(dir);
      expect(await openIn('finder', join(dir, 'notes.md'))).toEqual({ ok: true });
      expect(shell.showItemInFolder).toHaveBeenCalledWith(join(dir, 'notes.md'));
      vi.mocked(shell.openPath).mockResolvedValueOnce('Access denied');
      expect(await openIn('finder', dir)).toEqual({ ok: false, message: 'Access denied' });
      expect((await openIn('finder', join(dir, 'gone'))).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports the external terminal as unsupported off macOS', async () => {
    onPlatform('linux');
    expect(await openIn('terminal', '/work')).toEqual({ ok: false, message: 'External terminal launch is not yet supported on this platform.' });
  });

  it('opens only http(s) URLs in the browser', async () => {
    expect(await openIn('browser', 'https://example.com')).toEqual({ ok: true });
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
    expect((await openIn('browser', 'file:///etc/passwd')).ok).toBe(false);
  });
});

describe('openIn editors elsewhere', () => {
  it('keeps launching the CLI shim on Linux and returns the macOS-style hint on failure', async () => {
    onPlatform('linux');
    expect(await openIn('code', '/work')).toEqual({ ok: true });
    expect(h.spawns.map((s) => [s.cmd, s.args])).toEqual([['code', ['-n', '/work']]]);

    h.failing.add('idea');
    const failed = await openIn('intellij', '/work');
    expect(failed).toEqual({ ok: false, message: expect.stringContaining('Create Command-line Launcher') });
  });

  it('falls back on macOS to open -a, trying the app override first', async () => {
    onPlatform('darwin');
    h.failing.add('idea');
    h.macApps.add('IntelliJ IDEA CE');
    expect(await openIn('intellij', '/work', { intellijApp: 'My IDEA' })).toEqual({ ok: true });
    expect(h.spawns.filter((s) => s.cmd === '/usr/bin/open').map((s) => s.args[1])).toEqual([
      'My IDEA',
      'IntelliJ IDEA',
      'IntelliJ IDEA Ultimate',
      'IntelliJ IDEA CE'
    ]);
  });

  it('returns the install hint on macOS when neither the CLI nor any app is found', async () => {
    onPlatform('darwin');
    h.failing.add('cursor');
    expect(await openIn('cursor', '/work')).toEqual({ ok: false, message: expect.stringContaining('Cursor.app is in /Applications') });
    expect(h.spawns.at(-1)).toMatchObject({ cmd: '/usr/bin/open', args: ['-a', 'Cursor', '-n', '/work'] });
  });
});
