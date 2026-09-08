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

  it('sends only event name, distinct id, and projectId — never content', async () => {
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
      properties: { projectId: 'p1' }
    });
    expect(body).not.toHaveProperty('timestamp');
    expect(JSON.stringify(body)).not.toContain('threadId');
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
});
