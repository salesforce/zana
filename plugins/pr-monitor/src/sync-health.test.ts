import { describe, it, expect } from 'vitest';
import { reduceSyncHealth, isKeptGone, REMOTE_GONE_CONFIRM_PASSES, type RepoProbe } from '../lib/sync-health.js';
import { EMPTY_SYNC_HEALTH_STATE, type SyncHealthState } from '../lib/types.js';

/**
 * The pure R-REPO-013/015/016 reducer: disconnect precedence (AC-REPO-15.5),
 * per-host outage aggregation (AC-REPO-15.1/13.6), remote-gone 2-pass debounce
 * (AC-REPO-16.5), kept-gone exclusion + auto-clear (AC-REPO-16.3/15.4).
 */

function probe(over: Partial<RepoProbe>): RepoProbe {
  return { name: 'acme/widgets', host: 'github.com', fault: 'ok', ...over };
}

describe('reduceSyncHealth — disconnect (AC-REPO-13.1/15.5)', () => {
  it('surfaces a host with invalid gh auth as disconnected', () => {
    const { health } = reduceSyncHealth(undefined, [], ['git.soma']);
    expect(health.disconnectedHosts).toEqual(['git.soma']);
    expect(health.outageHosts).toEqual([]);
  });

  it('AC-REPO-15.5: auth-invalid takes precedence — a host is never both disconnected and outage', () => {
    // Same host: auth is bad AND its only repo probed as outage. Disconnect wins.
    const { health } = reduceSyncHealth(
      undefined,
      [probe({ host: 'git.soma', fault: 'outage' })],
      ['git.soma']
    );
    expect(health.disconnectedHosts).toEqual(['git.soma']);
    expect(health.outageHosts).toEqual([]);
  });

  it('a probe classified disconnect also disconnects its host', () => {
    const { health } = reduceSyncHealth(undefined, [probe({ fault: 'disconnect' })], []);
    expect(health.disconnectedHosts).toEqual(['github.com']);
  });
});

describe('reduceSyncHealth — outage (AC-REPO-15.1/13.6)', () => {
  it('a host is in outage when every connected repo failed transiently', () => {
    const { health } = reduceSyncHealth(
      undefined,
      [probe({ name: 'a/b', fault: 'outage' }), probe({ name: 'a/c', fault: 'outage' })],
      []
    );
    expect(health.outageHosts).toEqual(['github.com']);
  });

  it('AC-REPO-13.6: one healthy repo keeps the host out of outage (per-host, not global)', () => {
    const { health } = reduceSyncHealth(
      undefined,
      [probe({ name: 'a/b', fault: 'outage' }), probe({ name: 'a/c', fault: 'ok' })],
      []
    );
    expect(health.outageHosts).toEqual([]);
  });

  it('faults are per host — one host outage, another healthy', () => {
    const { health } = reduceSyncHealth(
      undefined,
      [
        probe({ name: 'a/b', host: 'h1', fault: 'outage' }),
        probe({ name: 'c/d', host: 'h2', fault: 'ok' }),
      ],
      []
    );
    expect(health.outageHosts).toEqual(['h1']);
  });
});

describe('reduceSyncHealth — remote-gone debounce (AC-REPO-16.5)', () => {
  it('a single 404 pass does NOT prompt (needs 2 consecutive)', () => {
    const { state, health } = reduceSyncHealth(undefined, [probe({ name: 'a/b', fault: 'remote-gone' })], []);
    expect(health.remoteGone).toEqual([]);
    expect(state.gone404['a/b']).toBe(1);
  });

  it('two consecutive 404 passes confirm remote-gone', () => {
    const first = reduceSyncHealth(undefined, [probe({ name: 'a/b', fault: 'remote-gone' })], []);
    const second = reduceSyncHealth(first.state, [probe({ name: 'a/b', fault: 'remote-gone' })], []);
    expect(second.state.gone404['a/b']).toBe(REMOTE_GONE_CONFIRM_PASSES);
    expect(second.health.remoteGone).toEqual(['a/b']);
  });

  it('a non-404 outcome between passes resets the counter (no prompt)', () => {
    const first = reduceSyncHealth(undefined, [probe({ name: 'a/b', fault: 'remote-gone' })], []);
    const recovered = reduceSyncHealth(first.state, [probe({ name: 'a/b', fault: 'ok' })], []);
    expect(recovered.state.gone404['a/b']).toBe(0);
    const again = reduceSyncHealth(recovered.state, [probe({ name: 'a/b', fault: 'remote-gone' })], []);
    expect(again.health.remoteGone).toEqual([]);
  });

  it('a 404 on a disconnected host does NOT count toward remote-gone (auth untrusted)', () => {
    const { state, health } = reduceSyncHealth(
      undefined,
      [probe({ name: 'a/b', fault: 'remote-gone' })],
      ['github.com']
    );
    expect(state.gone404['a/b']).toBe(0);
    expect(health.remoteGone).toEqual([]);
    expect(health.disconnectedHosts).toEqual(['github.com']);
  });
});

describe('reduceSyncHealth — kept-gone (AC-REPO-16.3/16.4/15.4)', () => {
  it('AC-REPO-16.4: a kept repo folds into keptGone, not remoteGone', () => {
    const prev: SyncHealthState = { gone404: { 'a/b': 2 }, kept: ['a/b'] };
    const { health } = reduceSyncHealth(prev, [probe({ name: 'a/b', fault: 'remote-gone' })], []);
    expect(health.remoteGone).toEqual([]); // kept, so no re-prompt
    expect(health.keptGone).toEqual(['a/b']);
  });

  it('AC-REPO-15.4: a kept repo that becomes reachable clears from kept', () => {
    const prev: SyncHealthState = { gone404: { 'a/b': 2 }, kept: ['a/b'] };
    const { state, health } = reduceSyncHealth(prev, [probe({ name: 'a/b', fault: 'ok' })], []);
    expect(state.kept).toEqual([]);
    expect(health.keptGone).toEqual([]);
  });

  it('isKeptGone gates a repo out of the sync pass', () => {
    const state: SyncHealthState = { gone404: {}, kept: ['acme/widgets'] };
    expect(isKeptGone(state, 'ACME/Widgets')).toBe(true);
    expect(isKeptGone(state, 'other/repo')).toBe(false);
    expect(isKeptGone(EMPTY_SYNC_HEALTH_STATE, 'acme/widgets')).toBe(false);
  });
});
