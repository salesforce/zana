import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from './server.mjs';

const DEFAULT_HOST = 'https://us.posthog.com';

function makeZcc(values) {
  const handlers = new Map();
  const rpc = new Map();
  const kv = new Map();
  let definedDescriptors = null;
  return {
    events: {
      on: (name, handler) => handlers.set(name, handler)
    },
    rpc: {
      method: (name, handler) => rpc.set(name, handler)
    },
    settings: {
      define: (descriptors) => {
        definedDescriptors = descriptors;
        return { get: async () => values };
      }
    },
    storage: {
      kv: {
        get: async (key) => kv.get(key),
        set: async (key, value) => {
          kv.set(key, value);
        }
      }
    },
    log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    _handlers: handlers,
    _rpc: rpc,
    get _definedDescriptors() {
      return definedDescriptors;
    }
  };
}

describe('posthog-analytics plugin', () => {
  const originalApiKey = process.env.ZCC_POSTHOG_API_KEY;

  beforeEach(() => {
    delete process.env.ZCC_POSTHOG_API_KEY;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-uuid' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalApiKey === undefined) delete process.env.ZCC_POSTHOG_API_KEY;
    else process.env.ZCC_POSTHOG_API_KEY = originalApiKey;
  });

  it('does not call fetch when disabled', async () => {
    const zcc = makeZcc({ enabled: false, apiKey: 'k', host: 'https://us.posthog.com' });
    plugin(zcc);
    await zcc._handlers.get('thread.created')({ projectId: 'p1' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not call fetch when enabled but no apiKey', async () => {
    const zcc = makeZcc({ enabled: true, apiKey: '', host: 'https://us.posthog.com' });
    plugin(zcc);
    await zcc._handlers.get('thread.created')({ projectId: 'p1' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends event name, distinct id, and projectId — never content — with the new fields defaulting to null', async () => {
    const zcc = makeZcc({ enabled: true, apiKey: 'k-123', host: 'https://us.posthog.com' });
    plugin(zcc);
    await zcc._handlers.get('thread.created')({ projectId: 'p1', threadId: 't1' });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://us.posthog.com/capture/');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      api_key: 'k-123',
      event: 'zcc_thread_created',
      distinct_id: 'fixed-uuid',
      properties: {
        projectId: 'p1',
        providerId: null,
        model: null,
        reasoningLevel: null,
        executionState: null,
        hadAttachments: null
      }
    });
    expect(body).not.toHaveProperty('timestamp');
    expect(JSON.stringify(body)).not.toContain('threadId');
  });

  it('forwards the new structural fields (providerId/model/reasoningLevel/executionState/hadAttachments) — still never content', async () => {
    const zcc = makeZcc({ enabled: true, apiKey: 'k-123', host: 'https://us.posthog.com' });
    plugin(zcc);
    await zcc._handlers.get('thread.active')({
      projectId: 'p1',
      threadId: 't1',
      providerId: 'claude-code',
      model: 'claude-sonnet-5',
      reasoningLevel: 'high',
      executionState: 'accept-edits',
      hadAttachments: true,
      // hostile extras that must never reach PostHog:
      promptText: 'do the secret thing',
      attachmentPath: '/Users/me/secret.png'
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.properties).toEqual({
      projectId: 'p1',
      providerId: 'claude-code',
      model: 'claude-sonnet-5',
      reasoningLevel: 'high',
      executionState: 'accept-edits',
      hadAttachments: true
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('promptText');
    expect(serialized).not.toContain('attachmentPath');
  });

  it('drops a non-scalar/wrong-typed new field rather than forwarding it', async () => {
    const zcc = makeZcc({ enabled: true, apiKey: 'k-123', host: 'https://us.posthog.com' });
    plugin(zcc);
    await zcc._handlers.get('thread.idle')({
      projectId: 'p1',
      providerId: 42,
      hadAttachments: 'yes'
    });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.properties.providerId).toBeNull();
    expect(body.properties.hadAttachments).toBeNull();
  });

  it('strips a trailing slash from a custom host', async () => {
    const zcc = makeZcc({ enabled: true, apiKey: 'k', host: 'https://self-hosted.example.com/' });
    plugin(zcc);
    await zcc._handlers.get('thread.idle')({ projectId: 'p2' });
    expect(fetch.mock.calls[0][0]).toBe('https://self-hosted.example.com/capture/');
  });

  it('swallows a fetch failure and logs it, never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const zcc = makeZcc({ enabled: true, apiKey: 'k', host: 'https://us.posthog.com' });
    plugin(zcc);
    await expect(zcc._handlers.get('thread.failed')({ projectId: 'p1' })).resolves.toBeUndefined();
    expect(zcc.log.warn).toHaveBeenCalledTimes(1);
    expect(zcc.log.warn.mock.calls[0][0]).toContain('posthog capture failed');
  });

  it('logs a warning when PostHog returns a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    const zcc = makeZcc({ enabled: true, apiKey: 'k', host: 'https://us.posthog.com' });
    plugin(zcc);
    await zcc._handlers.get('thread.created')({ projectId: 'p1' });
    expect(zcc.log.warn).toHaveBeenCalledTimes(1);
    expect(zcc.log.warn.mock.calls[0][0]).toContain('HTTP 401');
  });

  it('reuses one distinct id when two first-use events race', async () => {
    let uuidCalls = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        uuidCalls += 1;
        return `uuid-${uuidCalls}`;
      }
    });
    const zcc = makeZcc({ enabled: true, apiKey: 'k', host: 'https://us.posthog.com' });
    let releaseGet;
    const getStarted = new Promise((resolve) => {
      const originalGet = zcc.storage.kv.get.bind(zcc.storage.kv);
      zcc.storage.kv.get = async (key) => {
        resolve();
        await new Promise((r) => {
          releaseGet = r;
        });
        return originalGet(key);
      };
    });
    plugin(zcc);
    const first = zcc._handlers.get('thread.created')({ projectId: 'p1' });
    const second = zcc._handlers.get('thread.active')({ projectId: 'p1' });
    await getStarted;
    releaseGet();
    await Promise.all([first, second]);
    expect(uuidCalls).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    const ids = fetch.mock.calls.map(([, init]) => JSON.parse(init.body).distinct_id);
    expect(ids).toEqual(['uuid-1', 'uuid-1']);
  });

  it('defaults enabled to true and apiKey from ZCC_POSTHOG_API_KEY', () => {
    process.env.ZCC_POSTHOG_API_KEY = ' phc_from_env ';
    const zcc = makeZcc({ enabled: false, apiKey: '', host: DEFAULT_HOST });
    plugin(zcc);
    const descriptors = zcc._definedDescriptors;
    expect(descriptors.enabled.default).toBe(true);
    expect(descriptors.apiKey.default).toBe('phc_from_env');
    expect(descriptors.trackUiClicks.default).toBe(false);
    expect(descriptors.trackPageViews.default).toBe(false);
  });

  it('defaults apiKey to empty when ZCC_POSTHOG_API_KEY is unset', () => {
    const zcc = makeZcc({ enabled: true, apiKey: '', host: DEFAULT_HOST });
    plugin(zcc);
    expect(zcc._definedDescriptors.apiKey.default).toBe('');
  });

  it('registers a handler for every documented lifecycle event', () => {
    const zcc = makeZcc({ enabled: false, apiKey: '', host: DEFAULT_HOST });
    plugin(zcc);
    for (const name of ['thread.created', 'thread.active', 'thread.idle', 'thread.failed', 'thread.archived', 'thread.deleted']) {
      expect(zcc._handlers.has(name)).toBe(true);
    }
  });

  describe('trackUiClick RPC', () => {
    it('does not fetch when UI-click tracking is off (even if enabled)', async () => {
      const zcc = makeZcc({ enabled: true, trackUiClicks: false, apiKey: 'k', host: DEFAULT_HOST });
      plugin(zcc);
      const res = await zcc._rpc.get('trackUiClick')({ testid: 'agent-delete-quick', role: 'button' });
      expect(res).toEqual({ ok: false });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('does not fetch when the master switch is off', async () => {
      const zcc = makeZcc({ enabled: false, trackUiClicks: true, apiKey: 'k', host: DEFAULT_HOST });
      plugin(zcc);
      await zcc._rpc.get('trackUiClick')({ testid: 'x', role: 'button' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('sends only testid + role, never any other field', async () => {
      const zcc = makeZcc({ enabled: true, trackUiClicks: true, apiKey: 'k-9', host: DEFAULT_HOST });
      plugin(zcc);
      const res = await zcc._rpc.get('trackUiClick')({
        testid: 'agent-delete-quick',
        role: 'button',
        // hostile extras that must be dropped:
        text: 'Delete My Secret Project',
        ariaLabel: 'Delete thread about acquisition',
        value: 'user typed this'
      });
      expect(res).toEqual({ ok: true });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe('https://us.posthog.com/capture/');
      const body = JSON.parse(init.body);
      expect(body.event).toBe('zcc_ui_click');
      expect(body.properties).toEqual({ testid: 'agent-delete-quick', role: 'button' });
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('Secret');
      expect(serialized).not.toContain('acquisition');
      expect(serialized).not.toContain('user typed this');
    });

    it('ignores a payload with neither testid nor role', async () => {
      const zcc = makeZcc({ enabled: true, trackUiClicks: true, apiKey: 'k', host: DEFAULT_HOST });
      plugin(zcc);
      const res = await zcc._rpc.get('trackUiClick')({ text: 'nope' });
      expect(res).toEqual({ ok: false });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('drops an over-long or non-string field rather than forwarding it', async () => {
      const zcc = makeZcc({ enabled: true, trackUiClicks: true, apiKey: 'k', host: DEFAULT_HOST });
      plugin(zcc);
      await zcc._rpc.get('trackUiClick')({ testid: 'x'.repeat(500), role: 42 });
      // testid too long, role not a string → nothing identifiable left → no send
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('trackPageView RPC', () => {
    it('does not fetch when page-view tracking is off (even if enabled)', async () => {
      const zcc = makeZcc({ enabled: true, trackPageViews: false, apiKey: 'k', host: DEFAULT_HOST });
      plugin(zcc);
      const res = await zcc._rpc.get('trackPageView')({ from: 'inbox', to: 'agents', durationMs: 1200 });
      expect(res).toEqual({ ok: false });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('does not fetch when the master switch is off', async () => {
      const zcc = makeZcc({ enabled: false, trackPageViews: true, apiKey: 'k', host: DEFAULT_HOST });
      plugin(zcc);
      await zcc._rpc.get('trackPageView')({ from: 'inbox', to: 'agents', durationMs: 1200 });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('is independent of trackUiClicks — page views can be on while clicks stay off', async () => {
      const zcc = makeZcc({
        enabled: true,
        trackUiClicks: false,
        trackPageViews: true,
        apiKey: 'k',
        host: DEFAULT_HOST
      });
      plugin(zcc);
      const res = await zcc._rpc.get('trackPageView')({ from: 'home', to: 'settings', durationMs: 500 });
      expect(res).toEqual({ ok: true });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('sends only from/to/durationMs, never any other field', async () => {
      const zcc = makeZcc({ enabled: true, trackPageViews: true, apiKey: 'k-7', host: DEFAULT_HOST });
      plugin(zcc);
      const res = await zcc._rpc.get('trackPageView')({
        from: 'inbox',
        to: 'projects',
        durationMs: 4500,
        // hostile extras that must be dropped:
        projectId: 'proj-secret',
        path: '/projects/proj-secret/threads/abc'
      });
      expect(res).toEqual({ ok: true });
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.event).toBe('zcc_page_view');
      expect(body.properties).toEqual({ from: 'inbox', to: 'projects', durationMs: 4500 });
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('proj-secret');
    });

    it('treats a null/missing from as null but still sends when to is known', async () => {
      const zcc = makeZcc({ enabled: true, trackPageViews: true, apiKey: 'k', host: DEFAULT_HOST });
      plugin(zcc);
      const res = await zcc._rpc.get('trackPageView')({ to: 'agents', durationMs: 0 });
      expect(res).toEqual({ ok: true });
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.properties).toEqual({ from: null, to: 'agents', durationMs: 0 });
    });

    it('buckets an unknown nav value (e.g. a raw plugin id) as dropped rather than forwarded verbatim', async () => {
      const zcc = makeZcc({ enabled: true, trackPageViews: true, apiKey: 'k', host: DEFAULT_HOST });
      plugin(zcc);
      const res = await zcc._rpc.get('trackPageView')({ from: 'agents', to: 'some-third-party-plugin-id', durationMs: 100 });
      // "to" is not in the known enum → rejected outright (never forwarded verbatim)
      expect(res).toEqual({ ok: false });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects a negative durationMs', async () => {
      const zcc = makeZcc({ enabled: true, trackPageViews: true, apiKey: 'k', host: DEFAULT_HOST });
      plugin(zcc);
      const res = await zcc._rpc.get('trackPageView')({ from: 'home', to: 'agents', durationMs: -5 });
      expect(res).toEqual({ ok: false });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects a durationMs over the 24h sanity cap', async () => {
      const zcc = makeZcc({ enabled: true, trackPageViews: true, apiKey: 'k', host: DEFAULT_HOST });
      plugin(zcc);
      const res = await zcc._rpc.get('trackPageView')({ from: 'home', to: 'agents', durationMs: 25 * 60 * 60 * 1000 });
      expect(res).toEqual({ ok: false });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric or non-finite durationMs', async () => {
      const zcc = makeZcc({ enabled: true, trackPageViews: true, apiKey: 'k', host: DEFAULT_HOST });
      plugin(zcc);
      const resA = await zcc._rpc.get('trackPageView')({ from: 'home', to: 'agents', durationMs: 'soon' });
      const resB = await zcc._rpc.get('trackPageView')({ from: 'home', to: 'agents', durationMs: Infinity });
      expect(resA).toEqual({ ok: false });
      expect(resB).toEqual({ ok: false });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects a missing/unknown "to"', async () => {
      const zcc = makeZcc({ enabled: true, trackPageViews: true, apiKey: 'k', host: DEFAULT_HOST });
      plugin(zcc);
      const res = await zcc._rpc.get('trackPageView')({ from: 'home', durationMs: 10 });
      expect(res).toEqual({ ok: false });
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
