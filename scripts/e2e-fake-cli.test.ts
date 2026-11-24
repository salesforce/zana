import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { canObserveSigterm, writeFakeCli } from '../e2e/fixtures/fake-cli.js';

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

it('only claims an observable SIGTERM where Node delivers one', () => {
  expect(canObserveSigterm('linux')).toBe(true);
  expect(canObserveSigterm('darwin')).toBe(true);
  expect(canObserveSigterm('win32')).toBe(false);
});
