import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MARKETPLACE_UPSTREAM_URL,
  MARKETPLACE_MAX_BYTES,
  createLiveMarketplace,
  fetchUpstreamMarketplace,
  parseOfficialMarketplaceIndex,
  resolveMarketplaceUpstreamUrl
} from '../live-marketplace';
import type { OfficialMarketplaceIndex } from '../official-marketplace';

function catalog(ids: string[]): OfficialMarketplaceIndex {
  return {
    schemaVersion: 1,
    name: 'official',
    displayName: 'Zana Official',
    plugins: ids.map((id) => ({
      id,
      displayName: id,
      description: `${id} plugin`,
      author: { name: 'Zana' },
      source: { git: { url: 'https://github.com/salesforce/zana', subdir: `plugins/${id}`, ref: 'HEAD' } }
    }))
  };
}

const BUNDLED = catalog(['bundled']);

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  });
}

function loader(fetchImpl: typeof fetch, clock: { t: number }, overrides = {}) {
  return createLiveMarketplace({
    upstreamUrl: DEFAULT_MARKETPLACE_UPSTREAM_URL,
    fetchImpl,
    now: () => clock.t,
    ttlMs: 1000,
    bundled: () => BUNDLED,
    onError: () => undefined,
    ...overrides
  });
}

describe('resolveMarketplaceUpstreamUrl', () => {
  it('defaults to the raw GitHub catalog on main', () => {
    expect(resolveMarketplaceUpstreamUrl(undefined)).toBe(DEFAULT_MARKETPLACE_UPSTREAM_URL);
    expect(resolveMarketplaceUpstreamUrl('  ')).toBe(DEFAULT_MARKETPLACE_UPSTREAM_URL);
  });

  it('accepts an https override and disables on off/0/false', () => {
    expect(resolveMarketplaceUpstreamUrl('https://cdn.example/m.json')).toBe('https://cdn.example/m.json');
    for (const value of ['off', '0', 'FALSE']) expect(resolveMarketplaceUpstreamUrl(value)).toBeNull();
  });

  it('refuses a non-https override', () => {
    expect(resolveMarketplaceUpstreamUrl('http://cdn.example/m.json')).toBeNull();
  });
});

describe('parseOfficialMarketplaceIndex', () => {
  it('accepts the committed catalog shape', () => {
    expect(parseOfficialMarketplaceIndex(catalog(['a', 'b'])).plugins).toHaveLength(2);
  });

  it('accepts an npm source', () => {
    const value = catalog(['a']);
    value.plugins[0].source = { npm: { package: 'zcc-plugin-a', range: '^1.0.0' } };
    expect(parseOfficialMarketplaceIndex(value).plugins[0].id).toBe('a');
  });

  const broken: Array<[string, (value: any) => unknown]> = [
    ['a non-object', () => []],
    ['another schemaVersion', (v) => ({ ...v, schemaVersion: 2 })],
    ['another catalog name', (v) => ({ ...v, name: 'community' })],
    ['a missing displayName', (v) => ({ ...v, displayName: '' })],
    ['non-array plugins', (v) => ({ ...v, plugins: {} })],
    ['a non-object plugin', (v) => ({ ...v, plugins: [null] })],
    ['an invalid id', (v) => ({ ...v, plugins: [{ ...v.plugins[0], id: '../x' }] })],
    ['a duplicate id', (v) => ({ ...v, plugins: [v.plugins[0], v.plugins[0]] })],
    ['a missing plugin displayName', (v) => ({ ...v, plugins: [{ ...v.plugins[0], displayName: ' ' }] })],
    ['a missing description', (v) => ({ ...v, plugins: [{ ...v.plugins[0], description: undefined }] })],
    ['a missing author', (v) => ({ ...v, plugins: [{ ...v.plugins[0], author: {} }] })],
    ['a missing source', (v) => ({ ...v, plugins: [{ ...v.plugins[0], source: {} }] })],
    ['a git source without url', (v) => ({ ...v, plugins: [{ ...v.plugins[0], source: { git: {} } }] })],
    ['an npm source without package', (v) => ({ ...v, plugins: [{ ...v.plugins[0], source: { npm: {} } }] })]
  ];
  it.each(broken)('rejects %s', (_label, mutate) => {
    expect(() => parseOfficialMarketplaceIndex(mutate(catalog(['a'])))).toThrow();
  });
});

describe('fetchUpstreamMarketplace', () => {
  it('requests without caching or redirects and parses the body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(catalog(['a'])));
    const index = await fetchUpstreamMarketplace('https://x.test/m.json', fetchImpl as typeof fetch);
    expect(index.plugins[0].id).toBe('a');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://x.test/m.json',
      expect.objectContaining({ cache: 'no-store', redirect: 'error' })
    );
  });

  it('rejects a non-2xx answer', async () => {
    const fetchImpl = async () => new Response('nope', { status: 503 });
    await expect(fetchUpstreamMarketplace('https://x.test', fetchImpl)).rejects.toThrow('503');
  });

  it('rejects a declared oversize body before reading it', async () => {
    const fetchImpl = async () =>
      new Response('{}', { headers: { 'content-length': String(MARKETPLACE_MAX_BYTES + 1) } });
    await expect(fetchUpstreamMarketplace('https://x.test', fetchImpl)).rejects.toThrow('exceeds');
  });

  it('rejects a streamed body that grows past the cap', async () => {
    const chunk = new Uint8Array(256 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 5) controller.close();
        else controller.enqueue(chunk);
      }
    });
    const fetchImpl = async () => new Response(body);
    await expect(fetchUpstreamMarketplace('https://x.test', fetchImpl)).rejects.toThrow('exceeds');
  });

  it('rejects an empty body as invalid JSON', async () => {
    const fetchImpl = async () => new Response(null);
    await expect(fetchUpstreamMarketplace('https://x.test', fetchImpl)).rejects.toThrow();
  });

  it('aborts after the timeout', async () => {
    const fetchImpl = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    await expect(fetchUpstreamMarketplace('https://x.test', fetchImpl as typeof fetch, 10)).rejects.toThrow(
      'aborted'
    );
  });
});

describe('createLiveMarketplace', () => {
  it('serves the bundled copy without fetching when disabled', async () => {
    const fetchImpl = vi.fn();
    const load = loader(fetchImpl as unknown as typeof fetch, { t: 0 }, { upstreamUrl: null });
    expect(await load()).toBe(BUNDLED);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('serves the upstream catalog and caches it for the TTL', async () => {
    const clock = { t: 0 };
    const fetchImpl = vi.fn(async () => jsonResponse(catalog(['live'])));
    const load = loader(fetchImpl as typeof fetch, clock);
    expect((await load()).plugins[0].id).toBe('live');
    clock.t = 999;
    await load();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock.t = 2000;
    await load();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(catalog(['live'])));
    const load = loader(fetchImpl as typeof fetch, { t: 0 });
    const [a, b] = await Promise.all([load(), load()]);
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to the bundled copy on a cold-start failure and reports it', async () => {
    const onError = vi.fn();
    const fetchImpl = async () => new Response('down', { status: 500 });
    const load = loader(fetchImpl, { t: 0 }, { onError });
    expect(await load()).toBe(BUNDLED);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('keeps the last good catalog when a refresh fails or is invalid', async () => {
    const clock = { t: 0 };
    const responses = [
      jsonResponse(catalog(['live'])),
      new Response('down', { status: 502 }),
      jsonResponse({ schemaVersion: 1, name: 'official', displayName: 'x', plugins: [{}] })
    ];
    const load = loader(async () => responses.shift()!, clock);
    expect((await load()).plugins[0].id).toBe('live');
    clock.t = 2000;
    expect((await load()).plugins[0].id).toBe('live');
    clock.t = 4000;
    expect((await load()).plugins[0].id).toBe('live');
  });

  it('waits a full TTL after a failure before retrying', async () => {
    const clock = { t: 0 };
    const fetchImpl = vi.fn(async () => new Response('down', { status: 500 }));
    const load = loader(fetchImpl as typeof fetch, clock);
    await load();
    clock.t = 500;
    expect(await load()).toBe(BUNDLED);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('logs failures with the default reporter', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = createLiveMarketplace({
      upstreamUrl: 'https://x.test',
      fetchImpl: async () => new Response('down', { status: 500 }),
      bundled: () => BUNDLED
    });
    expect(await load()).toBe(BUNDLED);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('500'));
    warn.mockRestore();
  });

  it('reads MARKETPLACE_UPSTREAM_URL when no upstream is passed', async () => {
    vi.stubEnv('MARKETPLACE_UPSTREAM_URL', 'off');
    try {
      const fetchImpl = vi.fn();
      const load = createLiveMarketplace({ fetchImpl: fetchImpl as unknown as typeof fetch, bundled: () => BUNDLED });
      expect(await load()).toBe(BUNDLED);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
