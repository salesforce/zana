import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CMD_COMMAND_LINE_LIMIT,
  CREATE_PROCESS_COMMAND_LINE_LIMIT,
  SHIM_READ_CAP,
  assertWindowsCommandLineFits,
  forwardingShimTarget,
  parseForwardingShim,
  resetWindowsShimCacheForTests,
  windowsCommandLineLength,
  windowsDirectLaunch
} from '../windows-command.js';

const root = mkdtempSync(join(tmpdir(), 'windows-command-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// A folder with a space and an apostrophe, like a real user profile path.
const binDir = join(root, "real bin o'brien");
mkdirSync(binDir);
const exe = join(binDir, 'claude.exe');
writeFileSync(exe, 'MZ');
const shimDir = join(root, 'shims');
mkdirSync(shimDir);

let shimCount = 0;
function shim(text: string, name = `s${shimCount++}.cmd`): string {
  const path = join(shimDir, name);
  writeFileSync(path, text, { mode: 0o700 });
  return path;
}

beforeEach(() => resetWindowsShimCacheForTests());

describe('parseForwardingShim', () => {
  const at = join(shimDir, 'x.cmd');

  it.each([
    ['launcher one-liner', `@"${exe}" %*`],
    ['echo off + quoted target', `@echo off\r\n"${exe}" %*\r\n`],
    ['rem and :: comments and blank lines', `@ECHO OFF\r\nrem launcher\r\n:: note\r\n\r\n"${exe}" %*\r\n`]
  ])('unwraps %s', (_name, text) => {
    expect(parseForwardingShim(text, at)).toEqual({ command: exe, leadingArgs: [] });
  });

  it('keeps literal leading arguments and resolves %~dp0 against the shim folder', () => {
    const local = join(shimDir, 'node_modules', 'tool');
    mkdirSync(local, { recursive: true });
    writeFileSync(join(local, 'tool.exe'), 'MZ');
    // The platform separator, so the folder also resolves on the Linux CI runner.
    const text = `@ECHO off\r\n"%~dp0node_modules${sep}tool${sep}tool.exe" --flag "two words" %*\r\n`;
    expect(parseForwardingShim(text, at)).toEqual({
      command: join(local, 'tool.exe'),
      leadingArgs: ['--flag', 'two words']
    });
  });

  it.each([
    ['no %* forwarding', `@"${exe}"`],
    ['two commands', `@echo off\r\nset X=1\r\n"${exe}" %*`],
    ['an environment variable in an argument', `@"${exe}" --home %USERPROFILE% %*`],
    ['delayed expansion', `@"${exe}" !X! %*`],
    ['a pipe', `@"${exe}" %* | more`],
    ['a redirect before %*', `@"${exe}" > log %*`],
    ['an unbalanced quote', `@"${exe} %*`],
    ['a node script target (not an exe)', `@"node" "cli.js" %*`],
    ['a relative exe', `@claude.exe %*`],
    ['a missing exe', `@"${join(binDir, 'gone.exe')}" %*`],
    ['an empty file', ''],
    ['a bare %~dp0', `@%~dp0 %*`]
  ])('leaves a shim with %s alone', (_name, text) => {
    expect(parseForwardingShim(text, at)).toBeNull();
  });
});

describe('windowsDirectLaunch', () => {
  it('swaps a forwarding .cmd for its exe on win32 and keeps every argument verbatim', () => {
    const path = shim(`@"${exe}" %*`);
    const args = ['--append-system-prompt', 'a & b | c %PATH% ^ "quoted" \u2019x\u2019', '--settings', '{"a":1}'];
    expect(windowsDirectLaunch(path, args, 'win32')).toEqual({ command: exe, args });
  });

  it('matches .bat and upper-case extensions', () => {
    const path = shim(`@"${exe}" %*`, 'UPPER.BAT');
    expect(windowsDirectLaunch(path, ['-p'], 'win32')).toEqual({ command: exe, args: ['-p'] });
  });

  it('prepends the shim literal args', () => {
    const path = shim(`@"${exe}" --native %*`);
    expect(windowsDirectLaunch(path, ['-p'], 'win32').args).toEqual(['--native', '-p']);
  });

  it.each(['darwin', 'linux'] as const)('is identity on %s', (platform) => {
    const path = shim(`@"${exe}" %*`);
    expect(windowsDirectLaunch(path, ['-p'], platform)).toEqual({ command: path, args: ['-p'] });
  });

  it('is identity for an exe, an unparseable shim, a missing shim and an oversized shim', () => {
    const complex = shim(`@echo off\r\nsetlocal\r\n"${exe}" %*`);
    const big = shim(`@"${exe}" %*\r\n${'rem x\r\n'.repeat(SHIM_READ_CAP)}`);
    for (const command of [exe, complex, join(shimDir, 'missing.cmd'), big, shimDir + '.cmd']) {
      expect(windowsDirectLaunch(command, ['-p'], 'win32')).toEqual({ command, args: ['-p'] });
    }
  });
});

describe('forwardingShimTarget cache', () => {
  it('re-reads a shim after it changes and caches a miss', () => {
    const path = shim('@echo off\r\nsetlocal\r\n');
    expect(forwardingShimTarget(path)).toBeNull();
    expect(forwardingShimTarget(path)).toBeNull();
    writeFileSync(path, `@"${exe}" %*`);
    const later = new Date(Date.now() + 5_000);
    utimesSync(path, later, later);
    expect(forwardingShimTarget(path)).toEqual({ command: exe, leadingArgs: [] });
  });

  it('stays bounded when many shims are seen', () => {
    const first = shim(`@"${exe}" %*`);
    expect(forwardingShimTarget(first)).not.toBeNull();
    for (let i = 0; i < 70; i++) forwardingShimTarget(shim(`@"${exe}" %*`));
    // The first entry was evicted; re-parsing it still works.
    expect(forwardingShimTarget(first)).toEqual({ command: exe, leadingArgs: [] });
  });
});

describe('windowsCommandLineLength', () => {
  // node-pty's own builder: the exact string handed to CreateProcess.
  const { argsToCommandLine } = createRequire(import.meta.url)('node-pty/lib/windowsPtyAgent.js') as {
    argsToCommandLine: (file: string, args: string[]) => string;
  };

  it.each([
    [[]],
    [['plain', 'two words', '', 'tab\there']],
    [['"already quoted"', '"lopsided', 'ends"', 'a"b', 'trail\\', 'sp ace\\', 'x\\\\"y', '{"k":"v w"}']],
    [['--append-system-prompt', 'You are running inside Zana.\nUse "inbox_push".\\n C:\\Users\\x y\\']]
  ])('matches node-pty argsToCommandLine for %j', (args) => {
    const file = 'C:\\Program Files\\Claude\\claude.exe';
    expect(windowsCommandLineLength(file, args)).toBe(argsToCommandLine(file, args).length);
  });
});

describe('assertWindowsCommandLineFits', () => {
  const pad = (n: number) => 'x'.repeat(n);

  it('allows a batch file up to 8191 characters and rejects one past it', () => {
    const cmd = 'C:\\bin\\claude.cmd';
    const fits = pad(CMD_COMMAND_LINE_LIMIT - cmd.length - 1);
    expect(() => assertWindowsCommandLineFits(cmd, [fits], 'win32')).not.toThrow();
    expect(() => assertWindowsCommandLineFits(cmd, [fits + 'x'], 'win32')).toThrow(
      `Cannot start ${cmd}: its command line is 8192 characters, over the Windows limit of 8191. It is a batch file, so it runs through cmd.exe. Set the harness binary to the program's .exe instead.`
    );
  });

  it('allows an exe up to 32766 characters and rejects one past it, without the batch hint', () => {
    const exePath = 'C:\\bin\\claude.exe';
    const fits = pad(CREATE_PROCESS_COMMAND_LINE_LIMIT - exePath.length - 1);
    expect(() => assertWindowsCommandLineFits(exePath, [fits], 'win32')).not.toThrow();
    expect(() => assertWindowsCommandLineFits(exePath, [fits + 'x'], 'win32')).toThrow(
      /^Cannot start C:\\bin\\claude\.exe: its command line is 32767 characters, over the Windows limit of 32766\.$/
    );
  });

  it.each(['darwin', 'linux'] as const)('never throws on %s', (platform) => {
    expect(() => assertWindowsCommandLineFits('claude.cmd', [pad(100_000)], platform)).not.toThrow();
  });
});
