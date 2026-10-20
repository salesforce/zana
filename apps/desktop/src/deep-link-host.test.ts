import { describe, expect, it, vi } from 'vitest';
import { resolveDeepLinkChannel, type DeepLinkDelivery } from '@zana-ai/zcc-desktop-contract';
import {
  createDeepLinkHost,
  DEEP_LINK_PENDING_LIMIT,
  registerDeepLinkIpc,
  registerDeepLinkScheme,
  wantsSingleInstanceLock
} from './deep-link-host.js';

function makeHost(env: Record<string, string | undefined> = {}, isPackaged = true) {
  const delivered: DeepLinkDelivery[] = [];
  const logError = vi.fn();
  const deliver = vi.fn(async (d: DeepLinkDelivery) => {
    delivered.push(d);
  });
  const host = createDeepLinkHost({ channel: resolveDeepLinkChannel({ isPackaged, env }), deliver, logError });
  return { host, delivered, deliver, logError };
}

describe('createDeepLinkHost', () => {
  it('queues links that arrive before arm and flushes them in order', async () => {
    const { host, delivered } = makeHost();
    expect(host.submitOsLink('zana://plugin/a/one?d=1')).toBe(true);
    expect(host.submitOsLink('zana://plugin/a/two')).toBe(true);
    expect(host.pendingCount()).toBe(2);
    expect(delivered).toEqual([]);
    host.arm();
    host.arm();
    await vi.waitFor(() => expect(delivered).toHaveLength(2));
    expect(delivered).toEqual([
      { pluginId: 'a', route: 'one', payload: '1' },
      { pluginId: 'a', route: 'two', payload: null }
    ]);
    expect(host.pendingCount()).toBe(0);
  });

  it('delivers directly once armed', async () => {
    const { host, delivered } = makeHost();
    host.arm();
    host.submitOsLink('zana://plugin/a/go');
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
  });

  it('bounds the pre-arm queue by dropping the oldest', async () => {
    const { host, delivered } = makeHost();
    for (let i = 0; i < DEEP_LINK_PENDING_LIMIT + 3; i++) host.submitOsLink(`zana://plugin/a/r${i}`);
    expect(host.pendingCount()).toBe(DEEP_LINK_PENDING_LIMIT);
    host.arm();
    await vi.waitFor(() => expect(delivered).toHaveLength(DEEP_LINK_PENDING_LIMIT));
    expect((delivered[0] as DeepLinkDelivery).route).toBe('r3');
  });

  it('ignores OS links with the wrong scheme or bad shape, logging only the reason', () => {
    const { host, logError, deliver } = makeHost();
    host.arm();
    expect(host.submitOsLink('zana-dev://plugin/a/b')).toBe(false);
    expect(host.submitOsLink('zana://plugin/../x')).toBe(false);
    expect(host.submitOsLink(undefined)).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith('deepLink.rejected', 'wrong-scheme');
    expect(logError.mock.calls.every(([, detail]) => typeof detail === 'string' && !detail.includes('plugin/'))).toBe(true);
  });

  it('reads a link from second-instance argv and ignores argv without one', async () => {
    const { host, delivered } = makeHost();
    host.arm();
    expect(host.submitArgv(['app', '--x', 'zana://plugin/a/b?d=z'])).toBe(true);
    expect(host.submitArgv(['app', '--x'])).toBe(false);
    expect(host.submitArgv('nope' as never)).toBe(false);
    await vi.waitFor(() => expect(delivered).toEqual([{ pluginId: 'a', route: 'b', payload: 'z' }]));
  });

  it('accepts every known scheme on the paste path but rejects garbage', async () => {
    const { host, delivered } = makeHost();
    host.arm();
    expect(await host.open('zana-dev://plugin/a/b?d=1')).toEqual({ ok: true, pluginId: 'a', route: 'b' });
    expect(await host.open('zana://plugin/c/d')).toEqual({ ok: true, pluginId: 'c', route: 'd' });
    expect(await host.open('https://plugin/a/b')).toEqual({ ok: false, reason: 'wrong-scheme' });
    expect(await host.open({})).toEqual({ ok: false, reason: 'not-a-string' });
    expect(delivered).toHaveLength(2);
  });

  it('keeps delivering after a delivery failure', async () => {
    const delivered: string[] = [];
    const logError = vi.fn();
    const host = createDeepLinkHost({
      channel: resolveDeepLinkChannel({ isPackaged: true, env: {} }),
      logError,
      deliver: async (d) => {
        if (d.route === 'bad') throw new Error('window gone');
        delivered.push(d.route);
      }
    });
    host.arm();
    host.submitOsLink('zana://plugin/a/bad');
    host.submitOsLink('zana://plugin/a/good');
    await vi.waitFor(() => expect(delivered).toEqual(['good']));
    expect(logError).toHaveBeenCalledWith('deepLink.deliver', expect.any(Error));
  });

  it('exposes the base and accepted schemes, including an E2E override', () => {
    expect(makeHost().host.config()).toEqual({ base: 'zana://', acceptSchemes: ['zana', 'zana-dev'] });
    const e2e = makeHost({ ZCC_E2E_HOME: '/h', ZCC_E2E_DEEP_LINK_SCHEME: 'zana-e2e' }, false).host;
    expect(e2e.config()).toEqual({ base: 'zana-e2e://', acceptSchemes: ['zana', 'zana-dev', 'zana-e2e'] });
    expect(e2e.submitOsLink('zana-e2e://plugin/a/b')).toBe(true);
    expect(e2e.submitOsLink('zana://plugin/a/b')).toBe(false);
    expect(makeHost({ ZCC_E2E_HOME: '/h' }, false).host.config().base).toBeNull();
  });
});

describe('registerDeepLinkScheme', () => {
  function input(over: Partial<Parameters<typeof registerDeepLinkScheme>[0]> & { env?: Record<string, string> } = {}) {
    const env = over.env ?? {};
    const isPackaged = over.isPackaged ?? true;
    const setAsDefaultProtocolClient = vi.fn(() => true);
    const log = vi.fn();
    return {
      args: {
        channel: resolveDeepLinkChannel({ isPackaged, env }),
        isPackaged,
        platform: 'linux' as NodeJS.Platform,
        env,
        execPath: '/usr/bin/electron',
        appEntry: '/repo/out-dev/main/index.js',
        setAsDefaultProtocolClient,
        log,
        ...over
      },
      setAsDefaultProtocolClient,
      log
    };
  }

  it('registers the prod scheme for packaged builds', () => {
    const t = input();
    expect(registerDeepLinkScheme(t.args)).toBe('registered');
    expect(t.setAsDefaultProtocolClient).toHaveBeenCalledWith('zana');
  });

  it('reports a failed OS registration', () => {
    const t = input();
    t.setAsDefaultProtocolClient.mockReturnValue(false);
    expect(registerDeepLinkScheme(t.args)).toBe('failed');
  });

  it('never registers under E2E, even packaged or with the dev flag', () => {
    for (const isPackaged of [true, false]) {
      const t = input({ isPackaged, env: { ZCC_E2E_HOME: '/h', ZCC_REGISTER_DEV_PROTOCOL: '1', ZCC_E2E_DEEP_LINK_SCHEME: 'x-e2e' } });
      expect(registerDeepLinkScheme(t.args)).toBe('skipped-e2e');
      expect(t.setAsDefaultProtocolClient).not.toHaveBeenCalled();
    }
  });

  it('skips dev unless ZCC_REGISTER_DEV_PROTOCOL=1', () => {
    const t = input({ isPackaged: false });
    expect(registerDeepLinkScheme(t.args)).toBe('skipped-not-enabled');
    expect(t.setAsDefaultProtocolClient).not.toHaveBeenCalled();
  });

  it('registers dev on Windows/Linux with execPath and the script, never on macOS', () => {
    const t = input({ isPackaged: false, env: { ZCC_REGISTER_DEV_PROTOCOL: '1' } });
    expect(registerDeepLinkScheme(t.args)).toBe('registered');
    expect(t.setAsDefaultProtocolClient).toHaveBeenCalledWith('zana-dev', '/usr/bin/electron', ['/repo/out-dev/main/index.js']);
    const mac = input({ isPackaged: false, env: { ZCC_REGISTER_DEV_PROTOCOL: '1' }, platform: 'darwin' });
    expect(registerDeepLinkScheme(mac.args)).toBe('skipped-mac-dev');
    expect(mac.setAsDefaultProtocolClient).not.toHaveBeenCalled();
    expect(mac.log).toHaveBeenCalled();
    const noEntry = input({ isPackaged: false, env: { ZCC_REGISTER_DEV_PROTOCOL: '1' }, appEntry: undefined });
    expect(registerDeepLinkScheme(noEntry.args)).toBe('skipped-no-entry');
  });

  it('skips when the channel owns no scheme', () => {
    const t = input({ isPackaged: false, env: {} });
    t.args.channel = { ...t.args.channel, scheme: null };
    expect(registerDeepLinkScheme(t.args)).toBe('skipped-no-scheme');
  });
});

describe('wantsSingleInstanceLock', () => {
  it('locks packaged builds, isolated dev, and never E2E', () => {
    expect(wantsSingleInstanceLock({ isPackaged: true, env: {} })).toBe(true);
    expect(wantsSingleInstanceLock({ isPackaged: false, env: { ZCC_DATA_DIR: '/d' } })).toBe(true);
    expect(wantsSingleInstanceLock({ isPackaged: false, env: {} })).toBe(false);
    expect(wantsSingleInstanceLock({ isPackaged: false, env: { ZCC_DATA_DIR: ' ' } })).toBe(false);
    expect(wantsSingleInstanceLock({ isPackaged: false, env: { ZCC_DATA_DIR: '/d', ZCC_E2E_HOME: '/h' } })).toBe(false);
  });
});

describe('registerDeepLinkIpc', () => {
  it('serves config and open, failing closed on error', async () => {
    const { host } = makeHost();
    host.arm();
    const handlers = new Map<string, { handler: (...a: never[]) => unknown; onError: (...a: never[]) => unknown }>();
    registerDeepLinkIpc(((channel: string, handler: never, onError: never) => {
      handlers.set(channel, { handler, onError });
    }) as never, host);
    expect([...handlers.keys()].sort()).toEqual(['deepLinks:config', 'deepLinks:open']);
    expect((handlers.get('deepLinks:config')!.handler as () => unknown)()).toEqual(host.config());
    const open = handlers.get('deepLinks:open')!;
    expect(await (open.handler as (w: unknown, r: unknown) => Promise<unknown>)({}, 'zana://plugin/a/b')).toEqual({ ok: true, pluginId: 'a', route: 'b' });
    expect((open.onError as (e: unknown, r: unknown) => unknown)(new Error('x'), 'r')).toEqual({ ok: false, reason: 'unavailable' });
    expect((handlers.get('deepLinks:config')!.onError as () => unknown)()).toEqual({ base: null, acceptSchemes: [] });
  });
});
