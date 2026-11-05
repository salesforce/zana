import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginProcessTracker, PLUGIN_PROCESS_LIMIT } from './plugin-process-tracker.js';
import { createPluginApi } from './plugin-api.js';

const posix = process.platform !== 'win32';
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise(r => setTimeout(r, 20)); }
}

describe('plugin process tracker', () => {
  let dir: string;
  const cleanup: number[] = [];
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'plugin-proc-')); });
  afterEach(() => {
    for (const pid of cleanup.splice(0)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    rmSync(dir, { recursive: true, force: true });
  });
  const grandchildScript = (file: string, ignoreTerm = false) =>
    `${ignoreTerm ? 'trap "" TERM; ' : ''}sleep 300 & echo $! > ${file}; wait`;
  const readPid = async (file: string): Promise<number> => {
    await until(() => existsSync(file) && readFileSync(file, 'utf8').trim() !== '');
    const pid = Number(readFileSync(file, 'utf8').trim());
    cleanup.push(pid);
    return pid;
  };

  it.skipIf(!posix)('reaps the whole process group, grandchildren included, on reapAll', async () => {
    const tracker = createPluginProcessTracker({ pluginId: 'p', graceMs: 1_000 });
    const file = join(dir, 'gc');
    const handle = await tracker.spawn('sh', ['-c', grandchildScript(file)]);
    cleanup.push(handle.pid);
    const grandchild = await readPid(file);
    expect(tracker.size).toBe(1);
    await tracker.reapAll();
    expect(await handle.exited).toBeNull();
    await until(() => !alive(grandchild));
    expect(alive(handle.pid)).toBe(false);
    expect(tracker.size).toBe(0);
  });

  it.skipIf(!posix)('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const log = vi.fn();
    const tracker = createPluginProcessTracker({ pluginId: 'p', graceMs: 150, log });
    const file = join(dir, 'gc');
    const handle = await tracker.spawn('sh', ['-c', grandchildScript(file, true)]);
    cleanup.push(handle.pid);
    const grandchild = await readPid(file);
    await tracker.reapAll();
    await until(() => !alive(grandchild) && !alive(handle.pid));
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('ignored SIGTERM'));
  });

  it('enforces the per-plugin concurrency cap and frees a slot on exit', async () => {
    const tracker = createPluginProcessTracker({ pluginId: 'p', maxProcesses: 2, graceMs: 200 });
    const a = await tracker.spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)']);
    const b = await tracker.spawn(process.execPath, ['-e', 'process.exit(3)']);
    cleanup.push(a.pid);
    expect(await b.exited).toBe(3);
    const c = await tracker.spawn(process.execPath, ['-e', 'process.exit(0)']);
    expect(await c.exited).toBe(0);
    const d = await tracker.spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)']);
    cleanup.push(d.pid);
    await expect(tracker.spawn(process.execPath, ['-e', ''])).rejects.toThrow('plugin process limit reached (2)');
    expect(PLUGIN_PROCESS_LIMIT).toBe(8);
    await tracker.reapAll();
  });

  it('refuses spawns after reap and rejects a missing executable without leaking a slot', async () => {
    const tracker = createPluginProcessTracker({ pluginId: 'p', graceMs: 100 });
    await expect(tracker.spawn('definitely-not-a-real-binary-zcc', [])).rejects.toThrow();
    expect(tracker.size).toBe(0);
    await tracker.reapAll();
    await tracker.reapAll();
    await expect(tracker.spawn(process.execPath, ['-e', ''])).rejects.toThrow('stale');
  });

  it('validates command, args, cwd and env', async () => {
    const tracker = createPluginProcessTracker({ pluginId: 'p' });
    await expect(tracker.spawn('', [])).rejects.toThrow('requires a command');
    await expect(tracker.spawn('x', [1 as unknown as string])).rejects.toThrow('args');
    await expect(tracker.spawn('x', Array(300).fill('a'))).rejects.toThrow('args');
    await expect(tracker.spawn('x', ['a'.repeat(200_000)])).rejects.toThrow('size limit');
    await expect(tracker.spawn('x', [], { cwd: 'relative' })).rejects.toThrow('absolute');
    await expect(tracker.spawn('x', [], { env: { A: 1 as unknown as string } })).rejects.toThrow('env');
    await expect(tracker.spawn('x', [], { env: { 'A=B': 'c' } })).rejects.toThrow('env');
  });

  it('passes env and cwd, discards output, never uses a shell', async () => {
    const tracker = createPluginProcessTracker({ pluginId: 'p' });
    const out = join(dir, 'out');
    const handle = await tracker.spawn(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(out)}, process.env.ZCC_T + '|' + process.cwd()); console.log('x'.repeat(200000))`], { cwd: dir, env: { ZCC_T: 'v' } });
    expect(await handle.exited).toBe(0);
    expect(readFileSync(out, 'utf8').startsWith('v|')).toBe(true);
    const meta = await tracker.spawn('echo', ['$HOME;rm']);
    expect(await meta.exited).toBe(0);
  });

  it.skipIf(!posix)('never signals a group it did not record', async () => {
    const bystander = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    bystander.unref();
    cleanup.push(bystander.pid!);
    const tracker = createPluginProcessTracker({ pluginId: 'p', graceMs: 100 });
    const own = await tracker.spawn('sleep', ['300']);
    cleanup.push(own.pid);
    await tracker.reapAll();
    await until(() => !alive(own.pid));
    expect(alive(bystander.pid!)).toBe(true);
  });
});

describe('plugin api process wiring', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'plugin-proc-api-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!posix)('reaps live children when the plugin is disposed, even with a dead worker', async () => {
    const handle = createPluginApi('proc-dead-worker', dir, { isWorkerAlive: () => false });
    const spawned = await handle.api.process.spawn('sleep', ['300']);
    expect(alive(spawned.pid)).toBe(true);
    await handle.dispose();
    await until(() => !alive(spawned.pid));
    await expect(handle.api.process.spawn('sleep', ['1'])).rejects.toThrow('stale');
  });

  it('exposes the exit promise off the wire and the wait function on it', async () => {
    const handle = createPluginApi('proc-wire', dir);
    const spawned = await handle.api.process.spawn(process.execPath, ['-e', 'process.exit(7)']) as unknown as { pid: number; exited: Promise<number | null>; wait(): Promise<number | null> };
    expect(Object.keys(spawned).sort()).toEqual(['pid', 'wait']);
    expect(await spawned.exited).toBe(7);
    expect(await spawned.wait()).toBe(7);
    await handle.dispose();
  });

  it('ships wait() as an async function so the worker bridge never calls it synchronously', async () => {
    const handle = createPluginApi('proc-async-wait', dir);
    const spawned = await handle.api.process.spawn(process.execPath, ['-e', 'process.exit(0)']) as unknown as { wait: () => Promise<number | null> };
    expect(spawned.wait.constructor.name).toBe('AsyncFunction');
    await handle.dispose();
  });
});
