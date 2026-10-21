import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Each spawn is recorded; the fake launcher then exits with `h.exit`, emits
// `h.error`, or (exit === 'hang') never finishes.
const h = vi.hoisted(() => ({
  spawns: [] as Array<{ cmd: string; args: string[]; opts: Record<string, unknown>; child: { kill: () => void } }>,
  exit: 0 as number | 'hang',
  error: null as Error | null,
  throws: null as unknown
}));
vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[], opts: Record<string, unknown>) => {
    if (h.throws) throw h.throws;
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), unref: vi.fn() });
    h.spawns.push({ cmd, args, opts, child });
    queueMicrotask(() => {
      if (h.error) return void child.emit('error', h.error);
      child.emit('spawn');
      if (h.exit !== 'hang') child.emit('exit', h.exit);
    });
    return child;
  }
}));
vi.mock('electron', () => ({ shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn(), openExternal: vi.fn(async () => {}) } }));

const { openIn, windowsTerminalScript } = await import('./openers.js');

const realPlatform = process.platform;
const realSystemRoot = process.env.SystemRoot;
let dir: string;

/** The PowerShell script carried by the spawn's -EncodedCommand. */
const decoded = (args: string[]) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  process.env.SystemRoot = 'C:\\Windows';
  dir = mkdtempSync(join(tmpdir(), "zcc-term it's Bob’s 100%PATH% & co-"));
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  if (realSystemRoot === undefined) delete process.env.SystemRoot;
  else process.env.SystemRoot = realSystemRoot;
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
  h.spawns = [];
  h.exit = 0;
  h.error = null;
  h.throws = null;
});

describe('windowsTerminalScript', () => {
  it('passes the folder and program as single-quoted literals', () => {
    expect(windowsTerminalScript("C:\\it's & %PATH% $env:x", 'pwsh')).toBe(
      "$ErrorActionPreference = 'Stop'; Start-Process -FilePath 'pwsh' -WorkingDirectory 'C:\\it''s & %PATH% $env:x'"
    );
  });

  it('doubles the curly quotes PowerShell also reads as single quotes', () => {
    expect(windowsTerminalScript('C:\\Users\\Bob\\Bob’s Projects', 'pwsh')).toBe(
      "$ErrorActionPreference = 'Stop'; Start-Process -FilePath 'pwsh' -WorkingDirectory 'C:\\Users\\Bob\\Bob’’s Projects'"
    );
    // A name built to close the literal stays inside it.
    expect(windowsTerminalScript('C:\\x’; Start-Process calc; ‘', 'my‚app‛')).toBe(
      "$ErrorActionPreference = 'Stop'; Start-Process -FilePath 'my‚‚app‛‛' -WorkingDirectory 'C:\\x’’; Start-Process calc; ‘‘'"
    );
  });
});

describe('openIn terminal on Windows', () => {
  it('starts PowerShell in the folder through a hidden, encoded launcher', async () => {
    expect(await openIn('terminal', dir)).toEqual({ ok: true });
    expect(h.spawns).toHaveLength(1);
    const [{ cmd, args, opts }] = h.spawns;
    expect(cmd).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand']);
    expect(opts).toEqual({ stdio: 'ignore', windowsHide: true });
    expect(decoded(args)).toBe(windowsTerminalScript(dir, 'powershell.exe'));
    expect(decoded(args)).toContain("it''s Bob’’s 100%PATH% & co-");
    // The folder never appears on the command line itself.
    expect(args.join(' ')).not.toContain('100%PATH%');
  });

  it('opens the containing folder for a file, and honours the preferred program', async () => {
    const file = join(dir, 'notes.md');
    writeFileSync(file, '');
    await openIn('terminal', file, { terminalApp: ' pwsh ' });
    expect(decoded(h.spawns[0].args)).toBe(windowsTerminalScript(dir, 'pwsh'));
  });

  it('falls back to powershell.exe on PATH when SystemRoot is unset', async () => {
    delete process.env.SystemRoot;
    await openIn('terminal', dir);
    expect(h.spawns[0].cmd).toBe('powershell.exe');
  });

  it('reports a missing folder without spawning', async () => {
    const result = await openIn('terminal', join(dir, 'gone'));
    expect(result.ok).toBe(false);
    expect(h.spawns).toEqual([]);
  });

  it('reports a launcher that exits non-zero, errors or throws', async () => {
    h.exit = 1;
    expect(await openIn('terminal', dir, { terminalApp: 'nope' })).toEqual({ ok: false, message: `Could not open nope in ${dir}.` });

    h.error = new Error('spawn powershell.exe ENOENT');
    expect((await openIn('terminal', dir)).message).toBe(`Could not open powershell.exe in ${dir}. spawn powershell.exe ENOENT`);

    h.throws = new Error('EPERM');
    expect((await openIn('terminal', dir)).message).toBe(`Could not open powershell.exe in ${dir}. EPERM`);

    h.throws = 'denied';
    expect((await openIn('terminal', dir)).message).toBe(`Could not open powershell.exe in ${dir}. denied`);
  });

  it('kills a launcher that never finishes', async () => {
    vi.useFakeTimers();
    h.exit = 'hang';
    const pending = openIn('terminal', dir);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toEqual({ ok: false, message: `Could not open powershell.exe in ${dir}. The launcher timed out.` });
    expect(h.spawns[0].child.kill).toHaveBeenCalled();
  });
});

describe('openIn terminal elsewhere', () => {
  it('still reports Linux as unsupported', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    expect(await openIn('terminal', dir)).toEqual({
      ok: false,
      message: 'External terminal launch is not yet supported on this platform.'
    });
    expect(h.spawns).toEqual([]);
  });

  it('leaves the other targets unchanged', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    for (const target of ['cursor', 'code', 'intellij'] as const) {
      expect(await openIn(target, dir)).toEqual({ ok: true });
    }
    expect(h.spawns.map((s) => s.cmd)).toEqual(['cursor', 'code', 'idea']);
    expect(await openIn('finder', dir)).toEqual({ ok: true });
    expect(await openIn('browser', 'https://example.com')).toEqual({ ok: true });
    expect((await openIn('browser', 'file:///etc/passwd')).ok).toBe(false);
  });
});
