import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { acpStopTestTitle, canObserveSigterm, quoteForCmdBatch, writeFakeCli } from '../e2e/fixtures/fake-cli.js';

const NODE_PATH = '/opt/node/bin/node';
const BODY = "console.log('fake');\n";
let bin: string;

beforeEach(() => { bin = mkdtempSync(join(tmpdir(), 'fake-cli-')); });
afterEach(() => { rmSync(bin, { recursive: true, force: true }); });

it('keeps the single extensionless shebang file on POSIX', () => {
  const files = writeFakeCli(bin, 'opencode', BODY, { platform: 'linux', nodePath: NODE_PATH });
  expect(files).toEqual([join(bin, 'opencode')]);
  expect(readFileSync(files[0]!, 'utf8')).toBe(`#!${NODE_PATH}\n${BODY}`);
  if (process.platform !== 'win32') expect(statSync(files[0]!).mode & 0o700).toBe(0o700);
});

it('writes a script plus a forwarding .cmd shim on Windows', () => {
  const files = writeFakeCli(bin, 'opencode', BODY, { platform: 'win32', nodePath: String.raw`C:\node\node.exe` });
  expect(files).toEqual([join(bin, 'opencode.mjs'), join(bin, 'opencode.cmd')]);
  expect(readFileSync(files[0]!, 'utf8')).toBe(BODY);
  expect(readFileSync(files[1]!, 'utf8')).toBe(`@echo off\r\n"C:\\node\\node.exe" "${join(bin, 'opencode.mjs')}" %*\r\n`);
});

it('doubles % in shim paths so cmd cannot expand them, and keeps other specials literal', () => {
  const nodePath = String.raw`C:\100%\a&b (x)^\node.exe`;
  const files = writeFakeCli(bin, 'opencode', BODY, { platform: 'win32', nodePath });
  expect(readFileSync(files[1]!, 'utf8')).toContain(String.raw`"C:\100%%\a&b (x)^\node.exe"`);
  expect(quoteForCmdBatch('%PATH%')).toBe('%%PATH%%');
});

it.each(['a"b', 'a\nb', 'a\rb'])('refuses a shim path that cannot be quoted: %j', value => {
  expect(() => quoteForCmdBatch(value)).toThrow('cannot be written into a .cmd shim');
});

it('names the Windows Stop test so it does not claim the SIGTERM escalation', () => {
  expect(acpStopTestTitle('linux')).toBe('Stop reaps a SIGTERM-resistant ACP child through the built provider');
  expect(acpStopTestTitle('win32')).not.toContain('SIGTERM-resistant');
  expect(acpStopTestTitle('win32')).toContain('Windows');
});

it('only claims an observable SIGTERM where Node delivers one', () => {
  expect(canObserveSigterm('linux')).toBe(true);
  expect(canObserveSigterm('darwin')).toBe(true);
  expect(canObserveSigterm('win32')).toBe(false);
});
