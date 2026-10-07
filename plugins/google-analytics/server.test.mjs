import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from './server.mjs';

const UUID = '6d5f800e-6c45-4c5b-a01f-f7aeab1c932d';
const input = (kind = 'open', page = 'home', extra = {}) => ({ kind, page, viewId: UUID, engagementMs: 0, ...extra });

function host(overrides = {}, saved) {
  let values;
  let changed;
  let dispose;
  let descriptors;
  const rpc = new Map();
  const kv = new Map(saved ? [['clientId', saved]] : []);
  const zcc = {
    settings: { define: (schema) => {
      descriptors = schema;
      values = { ...Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, v.default])), measurementId: 'G-TEST123', apiSecret: 'secret-value', ...overrides };
      return { get: async () => values, onChange: (fn) => { changed = fn; } };
    } },
    rpc: { method: (name, fn) => rpc.set(name, fn) },
    storage: { kv: { get: vi.fn(async (k) => kv.get(k)), set: vi.fn(async (k, v) => kv.set(k, v)) } },
    onDispose: (fn) => { dispose = fn; }, log: { warn: vi.fn() }
  };
  plugin(zcc);
  return {
    zcc, descriptors, rpc, kv,
    track: (value = input()) => rpc.get('track')(value),
    change: (next) => { values = { ...values, ...next }; changed(values); },
    dispose: () => dispose()
  };
}

function sent(index = 0) { return JSON.parse(fetch.mock.calls[index][1].body); }
function succeed() { return { ok: true, body: { cancel: vi.fn(async () => {}) } }; }

describe('Google Analytics collection', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(1800000000000);
    vi.stubEnv('ZCC_GA4_MEASUREMENT_ID', ''); vi.stubEnv('ZCC_GA4_API_SECRET', '');
    vi.stubEnv('ZCC_GA4_TEST_ENDPOINT', ''); vi.stubEnv('ZCC_E2E', '');
    vi.stubGlobal('fetch', vi.fn(async () => succeed()));
    vi.stubGlobal('crypto', { randomUUID: () => UUID });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('defaults to connected/page tracking, with secret credentials kept in Settings', () => {
    vi.stubEnv('ZCC_GA4_MEASUREMENT_ID', ' G-ENV '); vi.stubEnv('ZCC_GA4_API_SECRET', ' env-secret ');
    const { descriptors } = host();
    expect(descriptors.enabled.default).toBe(true);
    expect(descriptors.trackPageViews.default).toBe(true);
    expect(descriptors.measurementId.default).toBe('G-ENV');
    expect(descriptors.apiSecret).toMatchObject({ secret: true, default: 'env-secret' });
  });

  it.each([
    { enabled: false }, { measurementId: '' }, { measurementId: 'G-bad' },
    { apiSecret: '' }, { apiSecret: 'x'.repeat(257) }
  ])('sends nothing for disabled/unconfigured values %j', async (values) => {
    expect(await host(values).track()).toEqual({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('bundles app-open and initial-page events with Realtime fields and an installation id', async () => {
    const h = host();
    expect(await h.track(input('open', 'inbox', { title: 'private', path: '/secret', projectId: 'private' }))).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0];
    expect(url.href).toBe('https://www.google-analytics.com/mp/collect?measurement_id=G-TEST123&api_secret=secret-value');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) });
    expect(sent()).toEqual({
      client_id: UUID, consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
      events: [
        { name: 'app_open', params: { session_id: 1800000000000, engagement_time_msec: 1 } },
        { name: 'page_view', params: { session_id: 1800000000000, engagement_time_msec: 1, page_title: 'Inbox', page_location: 'https://app.zana.ai/inbox' } }
      ]
    });
    expect(JSON.stringify(sent())).not.toContain('private');
    expect(h.kv.get('clientId')).toBe(UUID);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reuses a persisted client id, replacing malformed stored values', async () => {
    const saved = '04ad4935-0e30-49df-9448-8a365782bfb6';
    const h = host({}, saved); await h.track();
    expect(sent().client_id).toBe(saved); expect(h.zcc.storage.kv.set).not.toHaveBeenCalled();
    await host({}, 'private-title').track(); expect(sent(1).client_id).toBe(UUID);
  });

  it('sends page changes and presence in the same session without any page data on presence', async () => {
    const h = host(); await h.track(); vi.advanceTimersByTime(1000);
    await h.track(input('page', 'agents', { engagementMs: 900 }));
    await h.track(input('heartbeat', 'agents', { engagementMs: 60000 }));
    expect(sent(1).events).toEqual([{ name: 'page_view', params: { session_id: 1800000000000, engagement_time_msec: 900, page_title: 'Agents', page_location: 'https://app.zana.ai/agents' } }]);
    expect(sent(2).events).toEqual([{ name: 'user_engagement', params: { session_id: 1800000000000, engagement_time_msec: 60000 } }]);
  });

  it('measures presence with page tracking off', async () => {
    const h = host({ trackPageViews: false }); await h.track();
    expect(sent().events.map(e => e.name)).toEqual(['app_open']);
    expect(await h.track(input('page', 'agents'))).toEqual({ ok: true, collected: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    await h.track(input('heartbeat')); expect(sent(1).events[0].name).toBe('user_engagement');
  });

  it.each([
    undefined, null, { kind: 'arbitrary' }, input('open', '/private'), input('open', '__proto__'),
    input('open', 'home', { viewId: 'private' }), input('open', 'home', { engagementMs: -1 }),
    input('open', 'home', { engagementMs: 60001 }), input('open', 'home', { engagementMs: NaN }),
    input('open', 'home', { engagementMs: 1.5 })
  ])('rejects malformed renderer input %j', async (value) => {
    const h = host();
    expect(await h.rpc.get('track')(value)).toEqual({ ok: false }); expect(fetch).not.toHaveBeenCalled();
  });

  it('deduplicates opens, unchanged pages, rapid page changes, and rapid heartbeats', async () => {
    const h = host(); await h.track(); await h.track();
    await h.track(input('page')); await h.track(input('page', 'agents'));
    await h.track(input('heartbeat')); expect(await h.track(input('heartbeat'))).toEqual({ ok: false });
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(55000); await h.track(input('heartbeat')); expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('requires an open on a new view or after 30 minutes away, creating a new session', async () => {
    const h = host(); expect(await h.track(input('heartbeat'))).toEqual({ ok: false, needsOpen: true });
    await h.track(); vi.advanceTimersByTime(30 * 60000);
    expect(await h.track(input('page', 'agents'))).toEqual({ ok: false, needsOpen: true });
    await h.track(); expect(sent(1).events[0].params.session_id).toBe(1800001800000);
  });

  it('caps retained views and evicts the oldest', async () => {
    const h = host(); await h.track();
    for (let i = 1; i <= 32; i++) await h.track(input('open', 'home', { viewId: `${String(i).padStart(8, '0')}-0e30-49df-9448-8a365782bfb6` }));
    expect(await h.track(input('heartbeat'))).toEqual({ ok: false, needsOpen: true });
  });

  it('shares a single identity initialization across concurrent first events', async () => {
    const h = host(); await Promise.all([h.track(), h.track(input('open', 'inbox', { viewId: '04ad4935-0e30-49df-9448-8a365782bfb6' }))]);
    expect(h.zcc.storage.kv.set).toHaveBeenCalledTimes(1);
  });

  it('recovers from identity storage failures', async () => {
    const h = host(); h.zcc.storage.kv.get.mockRejectedValueOnce(new Error('storage'));
    expect(await h.track()).toEqual({ ok: false }); expect(fetch).not.toHaveBeenCalled();
    expect(await h.track()).toEqual({ ok: true });
  });

  it('bounds concurrent work before awaiting storage and honors opt-out during initialization', async () => {
    const h = host(); let release;
    h.zcc.storage.kv.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = Array.from({ length: 4 }, () => h.track());
    await Promise.resolve();
    expect(await h.track()).toEqual({ ok: false });
    h.change({ enabled: false }); release(); await Promise.all(pending);
    expect(fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    h.change({ enabled: true }); expect(await h.track()).toEqual({ ok: true });
  });

  it('does not send stale credentials if settings change during storage initialization', async () => {
    const h = host(); let release;
    h.zcc.storage.kv.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = h.track(); await Promise.resolve(); h.change({ apiSecret: 'new-secret' }); release();
    expect(await pending).toEqual({ ok: false }); expect(fetch).not.toHaveBeenCalled();
  });

  it('handles HTTP and network failures without leaking secret URLs', async () => {
    const h = host(); fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    expect(await h.track()).toEqual({ ok: false });
    fetch.mockRejectedValueOnce(new Error('https://google/?api_secret=secret-value'));
    expect(await h.track()).toEqual({ ok: false });
    expect(JSON.stringify(h.zcc.log.warn.mock.calls)).not.toContain('secret-value');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['timeout', 'disconnect', 'dispose'])('aborts in-flight collection on %s', async (reason) => {
    const h = host();
    fetch.mockImplementationOnce(async (_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const pending = h.track(); await vi.advanceTimersByTimeAsync(0);
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(5000);
    else if (reason === 'disconnect') h.change({ enabled: false });
    else h.dispose();
    expect(await pending).toEqual({ ok: false }); expect(vi.getTimerCount()).toBe(0);
    if (reason === 'dispose') expect(await h.track()).toEqual({ ok: false });
  });

  it('accepts only an E2E loopback endpoint and ignores the override in ordinary use', async () => {
    vi.stubEnv('ZCC_GA4_TEST_ENDPOINT', 'http://127.0.0.1:1234/mp/collect');
    await host().track(); expect(fetch.mock.calls[0][0].hostname).toBe('www.google-analytics.com');
    vi.stubEnv('ZCC_E2E', '1'); await host().track(); expect(fetch.mock.calls[1][0].origin).toBe('http://127.0.0.1:1234');
  });

  it.each(['bad-url', 'https://127.0.0.1/mp/collect', 'http://external.example/mp/collect', 'http://user:pass@localhost/mp/collect', 'http://localhost/wrong', 'http://localhost/mp/collect?q=secret', 'http://localhost/mp/collect#bad'])('rejects unsafe collector %s', async (url) => {
    vi.stubEnv('ZCC_E2E', '1'); vi.stubEnv('ZCC_GA4_TEST_ENDPOINT', url);
    expect(await host().track()).toEqual({ ok: false }); expect(fetch).not.toHaveBeenCalled();
  });
});
