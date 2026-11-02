import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { removePluginTemporaryDirectory } from './plugin-cleanup.js';

const roots: string[] = [];
const root = () => { const dir = mkdtempSync(join(tmpdir(), 'plugin-cleanup-real-')); roots.push(dir); return dir; };
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })); });

it('removes a disposable tree and tolerates an already absent directory', async () => {
  const dir = root(); writeFileSync(join(dir, 'file'), 'temporary');
  await removePluginTemporaryDirectory(dir); await removePluginTemporaryDirectory(dir);
  expect(existsSync(dir)).toBe(false);
});

it.skipIf(process.platform !== 'win32')('retries real Windows cwd locks without blocking the event loop', async () => {
  const dir = root();
  const child = spawn(process.execPath, ['-e', "process.stdout.write('ready');setInterval(()=>{},1000)"], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'close');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await once(child.stdout!, 'data');
    timer = setTimeout(() => child.kill(), 150);
    await removePluginTemporaryDirectory(dir);
    expect(existsSync(dir)).toBe(false);
  } finally { clearTimeout(timer); child.kill(); await exited; }
});

it.skipIf(process.platform !== 'win32')('logs an exhausted real Windows lock and lets the caller retain its result', async () => {
  const dir = root(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const child = spawn(process.execPath, ['-e', "process.stdout.write('ready');setInterval(()=>{},1000)"], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'close');
  try {
    await once(child.stdout!, 'data');
    await expect(removePluginTemporaryDirectory(dir)).resolves.toBeUndefined();
    expect(existsSync(dir)).toBe(true); expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(dir));
  } finally { child.kill(); await exited; }
});
