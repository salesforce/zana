/**
 * Tests for the notify-only updater (apps/desktop/src/updater.ts). The real
 * electron-updater is replaced with a stub `autoUpdater` EventEmitter so we can
 * drive its event stream and assert on the status pushes / download calls.
 *
 * `app.isPackaged` is forced true — the dev branch is a trivial no-op shim and
 * the interesting logic (skip-version, error loudness, install-now, dedupe)
 * only runs in the packaged path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stub = vi.hoisted(() => {
  // hoisted runs before module imports, so build a minimal event emitter inline
  // rather than importing node:events (which isn't available this early).
  const listeners = new Map<string, Array<(...a: unknown[]) => void>>();
  const emitter = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    logger: undefined as unknown,
    checkForUpdates: vi.fn(async () => {}),
    downloadUpdate: vi.fn(async () => {}),
    quitAndInstall: vi.fn(() => {}),
    setFeedURL: vi.fn((_opts: unknown) => {}),
    on(event: string, fn: (...a: unknown[]) => void) {
      (listeners.get(event) ?? listeners.set(event, []).get(event)!).push(fn);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
      return true;
    },
    removeAllListeners() {
      listeners.clear();
      return this;
    }
  };
  return { autoUpdater: emitter };
});

vi.mock('electron', () => ({ app: { isPackaged: true } }));
vi.mock('electron-updater', () => ({ default: { autoUpdater: stub.autoUpdater } }));

const { createUpdater, DEFAULT_UPDATE_POLL_MS, friendlyUpdateError } = await import('./updater.js');
const { IPC } = await import('@zana-ai/zcc-desktop-contract');

describe('friendlyUpdateError', () => {
  it('maps the XML/YAML feed-parse error to an actionable message', () => {
    // The exact failure the user hit: an HTML page parsed as the YAML feed.
    const msg = friendlyUpdateError(new Error('Unexpected close tag Line: 34 Column: 9 Char: >'));
    expect(msg).toMatch(/no published release|update feed is unreachable/i);
    expect(msg).not.toMatch(/close tag|Char:/i); // raw parser noise is gone
  });

  it('maps other sax-parser phrasings of the same HTML-as-feed failure', () => {
    // The sax parser emits several distinct messages for an HTML page fed as the
    // YAML feed; they all share the "Line: N Column: M Char:" coordinate suffix.
    for (const raw of [
      'Attribute without value Line: 83 Column: 77 Char: >', // the reported one
      'Unquoted attribute value Line: 1 Column: 12 Char: <'
    ]) {
      const msg = friendlyUpdateError(new Error(raw));
      expect(msg).toMatch(/no published release|update feed is unreachable/i);
      expect(msg).not.toMatch(/Char:|Column:/i); // raw parser noise is gone
    }
  });

  it('maps 404 / offline errors to a reachability message', () => {
    expect(friendlyUpdateError(new Error('HttpError: 404 Not Found'))).toMatch(/feed|offline|release/i);
    expect(friendlyUpdateError(new Error('getaddrinfo ENOTFOUND example-release-host.invalid'))).toMatch(
      /feed|offline/i
    );
  });

  it('passes an ordinary message through unchanged', () => {
    expect(friendlyUpdateError(new Error('something specific went wrong'))).toBe(
      'something specific went wrong'
    );
  });
});

function makeUpdater(
  skipped?: string,
  opts?: { allowSimulation?: boolean; prepareQuitForUpdate?: () => void }
) {
  const sent: Array<{ channel: string; args: unknown[] }> = [];
  let skippedVersion = skipped;
  const updater = createUpdater({
    safeSend: (channel, ...args) => sent.push({ channel, args }),
    log: () => {},
    getSkippedVersion: () => skippedVersion,
    setSkippedVersion: (v) => {
      skippedVersion = v;
    },
    allowSimulation: opts?.allowSimulation,
    prepareQuitForUpdate: opts?.prepareQuitForUpdate
  });
  const statuses = () =>
    sent.filter((s) => s.channel === IPC.updates.onStatus).map((s) => s.args[0] as { kind: string; version?: string });
  const progresses = () =>
    sent.filter((s) => s.channel === IPC.updates.onProgress).map((s) => s.args[0] as { percent: number });
  return { updater, statuses, progresses, getSkipped: () => skippedVersion };
}

describe('createUpdater (notify-only)', () => {
  beforeEach(() => {
    stub.autoUpdater.removeAllListeners();
    (stub.autoUpdater.checkForUpdates as ReturnType<typeof vi.fn>).mockClear();
    (stub.autoUpdater.downloadUpdate as ReturnType<typeof vi.fn>).mockClear();
    (stub.autoUpdater.quitAndInstall as ReturnType<typeof vi.fn>).mockClear();
    (stub.autoUpdater.setFeedURL as ReturnType<typeof vi.fn>).mockClear();
    delete process.env.ZCC_UPDATE_FEED_URL;
    vi.useRealTimers();
  });
  afterEach(() => {
    delete process.env.ZCC_UPDATE_FEED_URL;
    vi.useRealTimers();
  });

  it('does NOT override the feed by default (uses the baked-in publish config)', () => {
    makeUpdater();
    expect(stub.autoUpdater.setFeedURL).not.toHaveBeenCalled();
  });

  it('points at a generic static feed when ZCC_UPDATE_FEED_URL is set', () => {
    process.env.ZCC_UPDATE_FEED_URL = 'https://cdn.example.com/app-updates/';
    makeUpdater();
    expect(stub.autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://cdn.example.com/app-updates/'
    });
  });

  it('ignores a non-HTTPS feed URL (never overrides with an insecure base)', () => {
    process.env.ZCC_UPDATE_FEED_URL = 'http://cdn.example.com/app-updates/';
    makeUpdater();
    expect(stub.autoUpdater.setFeedURL).not.toHaveBeenCalled();
  });

  it('disables auto-download (notify-only)', () => {
    makeUpdater();
    expect(stub.autoUpdater.autoDownload).toBe(false);
    expect(stub.autoUpdater.autoInstallOnAppQuit).toBe(true);
  });

  it('applies resolveRequestHeaders onto the client before a check', async () => {
    const resolve = vi.fn(async () => ({ Authorization: 'token abc' }));
    const updater = createUpdater({
      safeSend: () => {},
      log: () => {},
      getSkippedVersion: () => undefined,
      setSkippedVersion: () => {},
      resolveRequestHeaders: resolve
    });
    await updater.checkForUpdates();
    expect(resolve).toHaveBeenCalled();
    expect((stub.autoUpdater as { requestHeaders?: unknown }).requestHeaders).toEqual({
      Authorization: 'token abc'
    });
  });

  it('does not clobber headers when the resolver yields nothing', async () => {
    (stub.autoUpdater as { requestHeaders?: unknown }).requestHeaders = { keep: 'me' };
    const updater = createUpdater({
      safeSend: () => {},
      log: () => {},
      getSkippedVersion: () => undefined,
      setSkippedVersion: () => {},
      resolveRequestHeaders: async () => undefined
    });
    await updater.checkForUpdates();
    expect((stub.autoUpdater as { requestHeaders?: unknown }).requestHeaders).toEqual({ keep: 'me' });
    delete (stub.autoUpdater as { requestHeaders?: unknown }).requestHeaders;
  });

  it('emits `available` (not downloading) when a new version is found', async () => {
    const { updater, statuses } = makeUpdater();
    await updater.checkForUpdates();
    stub.autoUpdater.emit('update-available', { version: '1.2.3' });
    expect(statuses().at(-1)).toEqual({ kind: 'available', version: '1.2.3' });
    expect(stub.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('suppresses a skipped version (reports not-available instead)', async () => {
    const { updater, statuses } = makeUpdater('1.2.3');
    await updater.checkForUpdates();
    stub.autoUpdater.emit('update-available', { version: '1.2.3' });
    expect(statuses().at(-1)).toEqual({ kind: 'not-available' });
  });

  it('still offers a NEWER version than the skipped one', async () => {
    const { updater, statuses } = makeUpdater('1.2.3');
    await updater.checkForUpdates();
    stub.autoUpdater.emit('update-available', { version: '1.3.0' });
    expect(statuses().at(-1)).toEqual({ kind: 'available', version: '1.3.0' });
  });

  it('skipVersion persists the version and clears the offer', () => {
    const { updater, statuses, getSkipped } = makeUpdater();
    updater.skipVersion('1.2.3');
    expect(getSkipped()).toBe('1.2.3');
    expect(statuses().at(-1)).toEqual({ kind: 'not-available' });
  });

  it('dedupes identical consecutive status pushes', async () => {
    const { updater, statuses } = makeUpdater();
    await updater.checkForUpdates();
    stub.autoUpdater.emit('update-available', { version: '1.2.3' });
    stub.autoUpdater.emit('update-available', { version: '1.2.3' });
    expect(statuses().filter((s) => s.kind === 'available')).toHaveLength(1);
  });

  it('surfaces errors on a manual check but stays quiet on a background poll', async () => {
    const { updater, statuses } = makeUpdater();
    await updater.checkForUpdates({ manual: false });
    stub.autoUpdater.emit('error', new Error('offline'));
    expect(statuses().some((s) => s.kind === 'error')).toBe(false);

    await updater.checkForUpdates({ manual: true });
    stub.autoUpdater.emit('error', new Error('offline'));
    expect(statuses().some((s) => s.kind === 'error')).toBe(true);
  });

  it('download({installNow:true}) relaunches as soon as the artifact is staged', async () => {
    const prepareQuitForUpdate = vi.fn();
    const { updater } = makeUpdater(undefined, { prepareQuitForUpdate });
    await updater.downloadUpdate({ installNow: true });
    expect(stub.autoUpdater.downloadUpdate).toHaveBeenCalledOnce();
    stub.autoUpdater.emit('update-downloaded', { version: '1.2.3' });
    expect(prepareQuitForUpdate).toHaveBeenCalledOnce();
    expect(stub.autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('download({installNow:false}) does NOT relaunch on download (applies on quit)', async () => {
    const { updater } = makeUpdater();
    await updater.downloadUpdate({ installNow: false });
    stub.autoUpdater.emit('update-downloaded', { version: '1.2.3' });
    expect(stub.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('a FAILED install-now download does not leave a stale relaunch flag', async () => {
    const { updater } = makeUpdater();
    const dl = stub.autoUpdater.downloadUpdate as ReturnType<typeof vi.fn>;
    dl.mockRejectedValueOnce(new Error('network drop'));
    await updater.downloadUpdate({ installNow: true }); // rejects, flag must reset
    // A later artifact completing (e.g. on the next check) must NOT relaunch.
    stub.autoUpdater.emit('update-downloaded', { version: '1.2.3' });
    expect(stub.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('quitAndInstall is a no-op until an artifact is staged', () => {
    const prepareQuitForUpdate = vi.fn();
    const { updater } = makeUpdater(undefined, { prepareQuitForUpdate });
    updater.quitAndInstall(); // nothing downloaded yet
    expect(stub.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(prepareQuitForUpdate).not.toHaveBeenCalled();
    stub.autoUpdater.emit('update-downloaded', { version: '1.2.3' });
    updater.quitAndInstall();
    expect(prepareQuitForUpdate).toHaveBeenCalledOnce();
    expect(stub.autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('clears the target version on not-available (no stale downloading version)', async () => {
    const { updater, statuses } = makeUpdater();
    await updater.checkForUpdates();
    stub.autoUpdater.emit('update-available', { version: '1.2.3' });
    stub.autoUpdater.emit('update-not-available');
    // A stray progress tick after not-available must not report v1.2.3.
    stub.autoUpdater.emit('download-progress', { percent: 10 });
    const downloading = statuses().find((s) => s.kind === 'downloading');
    expect(downloading?.version).toBeUndefined();
  });

  it('start() arms a periodic poll; stop() clears it', async () => {
    vi.useFakeTimers();
    const { updater } = makeUpdater();
    const check = stub.autoUpdater.checkForUpdates as ReturnType<typeof vi.fn>;
    updater.start();
    updater.start(); // idempotent — no second timer
    await vi.advanceTimersByTimeAsync(DEFAULT_UPDATE_POLL_MS + 1);
    expect(check).toHaveBeenCalledTimes(1);
    updater.stop();
    await vi.advanceTimersByTimeAsync(DEFAULT_UPDATE_POLL_MS * 3);
    expect(check).toHaveBeenCalledTimes(1); // no further ticks after stop
  });

  it('skips an overlapping check while one is in flight', async () => {
    const { updater } = makeUpdater();
    const check = stub.autoUpdater.checkForUpdates as ReturnType<typeof vi.fn>;
    let release: () => void = () => {};
    check.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const first = updater.checkForUpdates();
    await updater.checkForUpdates(); // should no-op (in flight)
    expect(check).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});

describe('updater.simulate (dev/QA affordance)', () => {
  beforeEach(() => {
    stub.autoUpdater.removeAllListeners();
    (stub.autoUpdater.checkForUpdates as ReturnType<typeof vi.fn>).mockClear();
    (stub.autoUpdater.downloadUpdate as ReturnType<typeof vi.fn>).mockClear();
    (stub.autoUpdater.quitAndInstall as ReturnType<typeof vi.fn>).mockClear();
    vi.useRealTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('rejects when allowSimulation is not armed', async () => {
    const { updater, statuses } = makeUpdater();
    await expect(updater.simulate('9.9.9')).rejects.toThrow(/not enabled/i);
    expect(statuses()).toHaveLength(0);
  });

  it('rejects a junk version token when armed (no status emitted)', async () => {
    const { updater, statuses } = makeUpdater(undefined, { allowSimulation: true });
    await expect(updater.simulate('../etc/passwd')).rejects.toThrow(/invalid simulate version/i);
    expect(statuses()).toHaveLength(0);
  });

  it('walks available → downloading → downloaded without touching electron-updater', async () => {
    const { updater, statuses, progresses } = makeUpdater(undefined, { allowSimulation: true });
    await updater.simulate('v9.9.9'); // leading v is stripped
    const kinds = statuses().map((s) => s.kind);
    expect(kinds[0]).toBe('available');
    expect(kinds).toContain('downloading');
    expect(kinds.at(-1)).toBe('downloaded');
    expect(statuses().at(-1)).toEqual({ kind: 'downloaded', version: '9.9.9' });
    // Never emits `checking` (so the watchdog is never armed) and never calls the
    // real client.
    expect(kinds).not.toContain('checking');
    expect(stub.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(stub.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    // Progress was reported and reached 100%.
    expect(progresses().at(-1)?.percent).toBe(100);
  });

  it('leaves nothing staged — a follow-on quitAndInstall stays a no-op', async () => {
    const prepareQuitForUpdate = vi.fn();
    const { updater } = makeUpdater(undefined, { allowSimulation: true, prepareQuitForUpdate });
    await updater.simulate('9.9.9');
    updater.quitAndInstall();
    expect(stub.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(prepareQuitForUpdate).not.toHaveBeenCalled();
  });

  it('honors a skipped version (reports not-available, no fake flow)', async () => {
    const { updater, statuses } = makeUpdater('9.9.9', { allowSimulation: true });
    await updater.simulate('9.9.9');
    expect(statuses()).toEqual([{ kind: 'not-available' }]);
  });
});
