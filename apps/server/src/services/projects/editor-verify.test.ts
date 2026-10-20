import { describe, it, expect, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

// Mock the process module so the probe is deterministic — "installed" bins
// resolve with version output, everything else errors (missing bin).
const h = vi.hoisted(() => ({ installed: new Set<string>(), outputs: new Map<string, string>() }));
vi.mock('node:child_process', () => ({
  execFile: (cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    if (h.installed.has(cmd)) cb(null, h.outputs.get(cmd) ?? `${cmd} 1.0.0`, '');
    else cb(new Error('ENOENT'), '', '');
  }
}));

// Windows resolution is covered in editor-windows.test.ts; here it's a lookup
// table so the win32 branch is deterministic on any host.
const w = vi.hoisted(() => ({ exes: new Map<string, string>(), versions: new Map<string, string>() }));
vi.mock('./editor-windows.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./editor-windows.js')>()),
  resolveWindowsEditor: async (_target: string, binary: string) => w.exes.get(binary) ?? null,
  windowsEditorVersion: async (_target: string, exe: string) => w.versions.get(exe)
}));

const { verifyEditors, editorBinary } = await import('./editor-verify.js');

const baseConfig = { version: 1, fontSize: 13, lastProjectId: null } as unknown as AppConfig;

describe('editorBinary', () => {
  it('returns the default shim when no override', () => {
    expect(editorBinary('cursor', baseConfig)).toBe('cursor');
    expect(editorBinary('code', baseConfig)).toBe('code');
    expect(editorBinary('intellij', baseConfig)).toBe('idea');
  });

  it('honours a config override, ignoring blank', () => {
    expect(editorBinary('cursor', { ...baseConfig, editorCursorBinary: '/opt/cursor' })).toBe('/opt/cursor');
    expect(editorBinary('cursor', { ...baseConfig, editorCursorBinary: '   ' })).toBe('cursor');
  });
});

describe('verifyEditors', () => {
  it('reports installed editors with a first-line version, missing as not installed', async () => {
    h.installed = new Set(['cursor', 'idea']);
    h.outputs = new Map([
      ['cursor', 'Cursor 0.42.0\nbuild abc'],
      ['idea', 'IntelliJ IDEA 2024.1']
    ]);
    const results = await verifyEditors(baseConfig, 'linux');
    const byTarget = Object.fromEntries(results.map((r) => [r.target, r]));

    expect(byTarget.cursor.installed).toBe(true);
    expect(byTarget.cursor.version).toBe('Cursor 0.42.0'); // first line only
    expect(byTarget.code.installed).toBe(false);
    expect(byTarget.code.version).toBeUndefined();
    expect(byTarget.intellij.installed).toBe(true);
    // Every editor carries an install hint for the settings card.
    expect(byTarget.code.installHint).toMatch(/code/i);
  });

  it('probes the overridden binary', async () => {
    h.installed = new Set(['/opt/cursor']);
    h.outputs = new Map([['/opt/cursor', 'Cursor 9']]);
    const results = await verifyEditors({ ...baseConfig, editorCursorBinary: '/opt/cursor' }, 'linux');
    const cursor = results.find((r) => r.target === 'cursor')!;
    expect(cursor.binary).toBe('/opt/cursor');
    expect(cursor.installed).toBe(true);
  });

  it('on Windows reports the resolved executable instead of running the batch shim', async () => {
    // Even a shim `execFile` could "run" must not count — only the resolver does.
    h.installed = new Set(['cursor', 'code', 'idea']);
    w.exes = new Map([['code', 'C:\\VSC\\Code.exe'], ['idea', 'C:\\IDEA\\bin\\idea64.exe']]);
    w.versions = new Map([['C:\\VSC\\Code.exe', '1.105.1']]);
    const results = await verifyEditors(baseConfig, 'win32');
    const byTarget = Object.fromEntries(results.map((r) => [r.target, r]));

    expect(byTarget.code).toMatchObject({ installed: true, version: '1.105.1', binary: 'code' });
    expect(byTarget.intellij).toMatchObject({ installed: true, version: undefined });
    expect(byTarget.cursor).toMatchObject({ installed: false, version: undefined });
    expect(byTarget.code.installHint).toMatch(/Code\.exe/);
    expect(byTarget.code.installHint).not.toMatch(/Cmd\+Shift\+P/);
  });
});
