import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from './src/app.ts';
import { pageForPath } from './pages.js';

const UUID = '6d5f800e-6c45-4c5b-a01f-f7aeab1c932d';
let doc, path, rpc, abort;
function mount({ hidden = false, callRpc } = {}) {
  doc = new EventTarget(); doc.visibilityState = hidden ? 'hidden' : 'visible';
  path = { pathname: '/inbox', href: 'https://private/path' };
  rpc = callRpc || vi.fn(async () => ({ ok: true })); abort = new AbortController();
  vi.stubGlobal('document', doc); vi.stubGlobal('location', path);
  vi.stubGlobal('__ZCC_PLUGIN_HOST__', { callRpc: rpc });
  let dispose;
  app.setup({ contentScripts: { register: ({ mount }) => { dispose = mount({ pluginId: 'google-analytics', signal: abort.signal }); } } });
  return dispose;
}

describe('coarse page names', () => {
  it.each([
    ['/', 'home'], ['/inbox', 'inbox'], ['/threads/private', 'agents'], ['/sessions/private', 'agents'], ['/threads/new', 'agents'],
    ['/schedules/private', 'scheduler'], ['/settings/google-analytics', 'settings'], ['/extensions/plugins/private', 'extensions'],
    ['/projects/private', 'agents'], ['/projects/private/threads/private', 'agents'], ['/projects/private/sessions/private', 'agents'],
    ['/projects/private/settings', 'settings'], ['/projects/private/schedules/new', 'scheduler'], ['/projects/private/explorer', 'explorer'],
    ['/projects/private/library', 'library'], ['/projects/private/terminals', 'terminals'], ['/projects/private/private', 'plugin'],
    ['/plugins/private/panel', 'plugin'], ['/unknown?secret#secret', 'plugin'], ['/new', 'agents'], ['/goals', 'goals'], ['/projects', 'agents']
  ])('%s maps to %s', (path, page) => expect(pageForPath(path)).toBe(page));
});

describe('Google Analytics content script', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(1800000000000);
    vi.stubGlobal('crypto', { randomUUID: () => UUID });
  });
  afterEach(() => { abort?.abort(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('reports the initial page and open, then visible presence every minute', async () => {
    mount(); await vi.advanceTimersByTimeAsync(0);
    expect(rpc).toHaveBeenCalledWith('google-analytics', 'track', { kind: 'open', page: 'inbox', viewId: UUID, engagementMs: 0 });
    await vi.advanceTimersByTimeAsync(60000);
    expect(rpc).toHaveBeenLastCalledWith('google-analytics', 'track', { kind: 'heartbeat', page: 'inbox', viewId: UUID, engagementMs: 60000 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('observes push/replace URL changes without modifying History or sending raw URLs', async () => {
    mount(); await vi.advanceTimersByTimeAsync(0);
    path.pathname = '/projects/private/threads/secret'; await vi.advanceTimersByTimeAsync(1000);
    expect(rpc.mock.calls[1][2]).toEqual({ kind: 'page', page: 'agents', viewId: UUID, engagementMs: 1000 });
    path.pathname = '/sessions/another'; await vi.advanceTimersByTimeAsync(1000); expect(rpc).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/private|secret/);
  });

  it('does not count hidden time or send background heartbeats and reports the latest page on return', async () => {
    mount(); await vi.advanceTimersByTimeAsync(1000);
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
    path.pathname = '/settings'; await vi.advanceTimersByTimeAsync(120000); expect(rpc).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0);
    expect(rpc.mock.calls[1][2]).toMatchObject({ kind: 'page', page: 'settings', engagementMs: 1000 });
  });

  it('starts after being mounted hidden', async () => {
    mount({ hidden: true }); expect(rpc).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(60000);
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0);
    expect(rpc.mock.calls[0][2]).toMatchObject({ kind: 'open', engagementMs: 0 });
  });

  it('keeps presence cadence when page collection is disabled', async () => {
    mount({ callRpc: vi.fn(async (_plugin, _method, input) => ({ ok: true, collected: input.kind !== 'page' })) });
    await vi.advanceTimersByTimeAsync(0);
    for (const next of ['/agents', '/settings', '/inbox']) { path.pathname = next; await vi.advanceTimersByTimeAsync(15000); }
    await vi.advanceTimersByTimeAsync(15000);
    expect(rpc.mock.calls.at(-1)[2].kind).toBe('heartbeat');
    expect(rpc.mock.calls.at(-1)[2].engagementMs).toBe(60000);
  });

  it('retries disconnected/unconfigured collection once a minute, and reconnects', async () => {
    const callRpc = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    mount({ callRpc }); await vi.advanceTimersByTimeAsync(59000); expect(rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); expect(rpc.mock.calls[1][2].kind).toBe('open');
  });

  it('reopens immediately when the server session/view expired', async () => {
    const callRpc = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, needsOpen: true }).mockResolvedValue({ ok: true });
    mount({ callRpc }); await vi.advanceTimersByTimeAsync(61000);
    expect(rpc.mock.calls.map(c => c[2].kind)).toEqual(['open', 'heartbeat', 'open']);
  });

  it.each(['sync', 'async'])('contains %s RPC failures', async (mode) => {
    mount({ callRpc: vi.fn(() => { if (mode === 'sync') throw new Error('down'); return Promise.reject(new Error('down')); }) });
    await vi.advanceTimersByTimeAsync(60000); expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('bounds suspended time and prevents concurrent RPC calls', async () => {
    let release;
    mount({ callRpc: vi.fn(() => new Promise(resolve => { release = resolve; })) });
    await vi.advanceTimersByTimeAsync(120000); expect(rpc).toHaveBeenCalledTimes(1);
    release({ ok: true }); await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() + 3600000); await vi.advanceTimersByTimeAsync(1000);
    expect(rpc.mock.calls[1][2].engagementMs).toBe(60000);
  });

  it('cleans up its timer/listener on abort or repeated dispose, including pending responses', async () => {
    let release;
    const dispose = mount({ callRpc: vi.fn(() => new Promise(resolve => { release = resolve; })) });
    abort.abort(); dispose(); expect(vi.getTimerCount()).toBe(0);
    release({ ok: true }); await vi.advanceTimersByTimeAsync(60000);
    doc.dispatchEvent(new Event('visibilitychange')); expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not mount without its host/document or with an aborted signal', () => {
    vi.stubGlobal('__ZCC_PLUGIN_HOST__', undefined); vi.stubGlobal('document', undefined);
    const ac = new AbortController();
    const registration = []; app.setup({ contentScripts: { register: r => registration.push(r) } });
    expect(registration[0].mount({ signal: ac.signal })).toBeUndefined();
    mount(); abort.abort(); expect(registration[0].mount({ signal: abort.signal })).toBeUndefined();
  });
});
