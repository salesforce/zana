import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginApi } from './plugin-api.js';

describe('plugin dispose hook ordering and bounds', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'plugin-dispose-order-')); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });

  it('runs dispose hooks while the database is still open, then closes it', async () => {
    const handle = createPluginApi('ordered', dir);
    const db = handle.api.storage.database();
    db.runScript('CREATE TABLE t (v TEXT)');
    const seen: string[] = [];
    handle.api.onDispose(() => { db.prepare('INSERT INTO t VALUES (?)').run('late'); seen.push('wrote'); });
    await handle.dispose();
    expect(seen).toEqual(['wrote']);
    expect(() => db.prepare('SELECT 1').get()).toThrow();
  });

  it('logs hook errors and keeps running remaining hooks', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handle = createPluginApi('erroring', dir);
    const ran: string[] = [];
    handle.api.onDispose(() => { ran.push('first-registered'); });
    handle.api.onDispose(() => { throw new Error('boom'); });
    await handle.dispose();
    expect(ran).toEqual(['first-registered']);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('onDispose failed: boom'));
  });

  it('bounds a hung hook at 2s and continues', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handle = createPluginApi('hung', dir);
    const ran: string[] = [];
    handle.api.onDispose(() => { ran.push('after-hung'); });
    handle.api.onDispose(() => new Promise<void>(() => {}));
    const done = handle.dispose();
    await vi.advanceTimersByTimeAsync(2_000);
    await done;
    expect(ran).toEqual(['after-hung']);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('onDispose timed out after 2000ms'));
  });

  it('stops running hooks once the 5s total budget is spent', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handle = createPluginApi('budget', dir);
    const ran: string[] = [];
    handle.api.onDispose(() => { ran.push('never'); });
    for (let i = 0; i < 3; i++) handle.api.onDispose(() => new Promise<void>(() => {}));
    const done = handle.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(ran).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dispose budget exhausted'));
  });

  it('skips plugin hooks and reports it when the worker is dead, but still runs host teardown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handle = createPluginApi('dead', dir, { isWorkerAlive: () => false });
    const ran: string[] = [];
    handle.api.onDispose(() => { ran.push('plugin'); });
    handle.onQuiesce(() => { ran.push('host'); });
    await handle.dispose();
    expect(ran).toEqual(['host']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dispose skipped: worker dead'));
  });

  it('runs plugin hooks when the worker is alive', async () => {
    const handle = createPluginApi('alive', dir, { isWorkerAlive: () => true });
    const ran: string[] = [];
    handle.api.onDispose(() => { ran.push('plugin'); });
    await handle.dispose();
    expect(ran).toEqual(['plugin']);
  });
});
