import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from './server.mjs';

const DEFAULT_HOST = 'https://us.posthog.com';

function makeZcc(values) {
  const handlers = new Map();
  const kv = new Map();
  return {
    events: {
      on: (name, handler) => handlers.set(name, handler)
    },
    settings: {
      define: () => ({ get: async () => values })
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
    _handlers: handlers
  };
}

describe('posthog-analytics plugin', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-uuid' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
      properties: { projectId: 'p1' },
      timestamp: body.timestamp
    });
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
    await zcc._handlers.get('thread.failed')({ projectId: 'p1' });
    // handler itself never throws (it's fire-and-forget inside plugin()); give the
    // microtask queue a tick so the .catch() has run before asserting on the log.
    await new Promise((r) => setTimeout(r, 0));
    expect(zcc.log.warn).toHaveBeenCalledTimes(1);
    expect(zcc.log.warn.mock.calls[0][0]).toContain('posthog capture failed');
  });

  it('registers a handler for every documented lifecycle event', () => {
    const zcc = makeZcc({ enabled: false, apiKey: '', host: DEFAULT_HOST });
    plugin(zcc);
    for (const name of ['thread.created', 'thread.active', 'thread.idle', 'thread.failed', 'thread.archived', 'thread.deleted']) {
      expect(zcc._handlers.has(name)).toBe(true);
    }
  });
});
