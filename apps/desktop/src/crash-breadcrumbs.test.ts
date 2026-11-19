import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installCrashBreadcrumbs } from './crash-breadcrumbs.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function setup(memory?: { total: number; free: number; swapTotal?: number; swapFree?: number }) {
  const root = mkdtempSync(join(tmpdir(), 'breadcrumbs-'));
  dirs.push(root);
  const logsDir = join(root, 'logs');
  const appHandlers = new Map<string, (...a: any[]) => void>();
  const procHandlers = new Map<string, (...a: any[]) => void>();
  let tick: (() => void) | undefined;
  let clock = 0;
  const handle = installCrashBreadcrumbs({
    app: { on: (e, l) => { appHandlers.set(e, l); } },
    logsDir,
    processRef: {
      pid: 99,
      on: ((e: string, l: (...a: any[]) => void) => { procHandlers.set(e, l); return process; }) as never,
      memoryUsage: (() => ({ rss: 200 * 1048576 })) as never
    },
    systemMemory: () => memory,
    now: () => clock,
    setInterval: (fn) => { tick = fn; return {}; }
  });
  return { handle, appHandlers, procHandlers, tick: () => tick?.(), advance: (ms: number) => { clock += ms; }, read: () => readFileSync(handle.file, 'utf8') };
}

describe('crash breadcrumbs', () => {
  it('writes exit, quit and process-gone events synchronously', () => {
    const t = setup();
    t.procHandlers.get('exit')!(3);
    t.appHandlers.get('before-quit')!();
    t.appHandlers.get('will-quit')!();
    t.appHandlers.get('window-all-closed')!();
    t.appHandlers.get('quit')!({}, 7);
    t.appHandlers.get('render-process-gone')!({}, {}, { reason: 'oom', exitCode: -1 });
    t.appHandlers.get('child-process-gone')!({}, { type: 'Utility', reason: 'crashed', exitCode: 5, name: 'zcc-server' });
    const text = t.read();
    for (const needle of [
      'breadcrumbs installed', 'process exit code=3', 'app before-quit', 'app will-quit', 'app window-all-closed',
      'app quit exitCode=7', 'render-process-gone reason=oom exitCode=-1',
      'child-process-gone type=Utility reason=crashed exitCode=5 name=zcc-server'
    ]) expect(text).toContain(needle);
  });

  it('samples memory when low, and at most once a minute otherwise', () => {
    const low = setup({ total: 1000 * 1024, free: 100 * 1024, swapTotal: 2048 * 1024, swapFree: 512 * 1024 });
    expect(low.read()).toMatch(/memory freeMB=100 totalMB=1000 rssMB=200 swapFreeMB=512 swapTotalMB=2048/);
    low.tick();
    expect(low.read().match(/memory freeMB/g)).toHaveLength(2);

    const ok = setup({ total: 1000 * 1024, free: 900 * 1024 });
    expect(ok.read().match(/memory freeMB/g)).toHaveLength(1);
    ok.advance(10_000);
    ok.tick();
    expect(ok.read().match(/memory freeMB/g)).toHaveLength(1);
    ok.advance(60_000);
    ok.tick();
    expect(ok.read().match(/memory freeMB/g)).toHaveLength(2);
  });

  it('skips sampling without memory info and rotates an oversized file', () => {
    const none = setup(undefined);
    expect(none.read()).not.toContain('memory freeMB');
    writeFileSync(none.handle.file, 'x'.repeat(1024 * 1024 + 1));
    none.handle.write('after rotation');
    expect(readFileSync(none.handle.file, 'utf8')).toContain('after rotation');
    expect(readFileSync(`${none.handle.file}.1`, 'utf8').length).toBeGreaterThan(1024 * 1024);
  });

  it('never throws when the log directory is unusable', () => {
    const root = mkdtempSync(join(tmpdir(), 'breadcrumbs-'));
    dirs.push(root);
    const logsDir = join(root, 'file');
    writeFileSync(logsDir, 'not a directory');
    expect(() => installCrashBreadcrumbs({ app: { on: () => undefined }, logsDir, setInterval: () => ({}) })).not.toThrow();
  });

  it('is wired into the desktop bootstrap with local-only crash dumps', () => {
    const src = readFileSync(new URL('./bootstrap.ts', import.meta.url), 'utf8');
    expect(src).toContain('installCrashBreadcrumbs(');
    expect(src).toContain('uploadToServer: false');
    expect(src).toContain("'crash-dumps'");
  });
});
