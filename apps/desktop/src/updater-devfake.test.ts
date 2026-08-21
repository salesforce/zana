/**
 * Tests for the dev-only `ZCC_FAKE_UPDATE` shim in createUpdater (the branch
 * that lets the update banner be demoed in an unpackaged build). `app.isPackaged`
 * is forced FALSE here — the opposite of updater.test.ts — so this file
 * exercises the dev path specifically. Nothing touches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@zana-ai/zcc-domain/product';

vi.mock('electron', () => ({ app: { isPackaged: false } }));
// electron-updater's autoUpdater is constructed at module load and reaches for
// app.getVersion(); the dev-fake branch never touches it, but the import must
// resolve. A bare stub object is enough — the fake path returns before use.
vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }));

const { createUpdater } = await import('./updater.js');

function makeDeps() {
  const sent: Array<{ channel: string; args: unknown[] }> = [];
  let skipped: string | undefined;
  return {
    sent,
    getSkipped: () => skipped,
    deps: {
      safeSend: (channel: string, ...args: unknown[]) => sent.push({ channel, args }),
      log: () => {},
      getSkippedVersion: () => skipped,
      setSkippedVersion: (v: string) => {
        skipped = v;
      }
    }
  };
}

const statuses = (sent: Array<{ channel: string; args: unknown[] }>): UpdateStatus[] =>
  sent.filter((s) => s.channel === 'updates:onStatus').map((s) => s.args[0] as UpdateStatus);

describe('createUpdater — dev fake (ZCC_FAKE_UPDATE)', () => {
  beforeEach(() => {
    delete process.env.ZCC_FAKE_UPDATE;
  });
  afterEach(() => {
    delete process.env.ZCC_FAKE_UPDATE;
  });

  it('without the env var, an unpackaged build reports disabled (no fake)', async () => {
    const { sent, deps } = makeDeps();
    const u = createUpdater(deps);
    await u.checkForUpdates();
    expect(statuses(sent)).toEqual([{ kind: 'disabled' }]);
  });

  it('with the env var, checkForUpdates emits available with that version', async () => {
    process.env.ZCC_FAKE_UPDATE = 'v9.9.9';
    const { sent, deps } = makeDeps();
    const u = createUpdater(deps);
    await u.checkForUpdates();
    // leading v is stripped
    expect(statuses(sent)).toEqual([{ kind: 'available', version: '9.9.9' }]);
  });

  it('downloadUpdate walks downloading → downloaded and emits progress', async () => {
    vi.useFakeTimers();
    try {
      process.env.ZCC_FAKE_UPDATE = '9.9.9';
      const { sent, deps } = makeDeps();
      const u = createUpdater(deps);
      const p = u.downloadUpdate({ installNow: false });
      await vi.runAllTimersAsync();
      await p;
      const kinds = statuses(sent).map((s) => s.kind);
      expect(kinds[0]).toBe('downloading');
      expect(kinds.at(-1)).toBe('downloaded');
      // progress pushes happened on the dedicated channel
      expect(sent.some((s) => s.channel === 'updates:onProgress')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skipVersion persists the version and clears the offer', () => {
    process.env.ZCC_FAKE_UPDATE = '9.9.9';
    const { sent, getSkipped, deps } = makeDeps();
    const u = createUpdater(deps);
    u.skipVersion('9.9.9');
    expect(getSkipped()).toBe('9.9.9');
    expect(statuses(sent).at(-1)).toEqual({ kind: 'not-available' });
  });
});
