import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRemoteReapLedger,
  remoteReapOrphans,
  type RemoteReapEntry
} from '../remote-reap-ledger.js';

function entry(overrides: Partial<RemoteReapEntry> = {}): RemoteReapEntry {
  return {
    sessionId: 's1',
    target: 'user@box',
    probeOpts: ['-o', 'ServerAliveInterval=30'],
    pid: 4242,
    tmux: false,
    createdAt: 1000,
    ...overrides
  };
}

describe('remoteReapOrphans', () => {
  it('keeps only entries whose session is NOT recovered', () => {
    const entries = [entry({ sessionId: 'live' }), entry({ sessionId: 'dead' })];
    const orphans = remoteReapOrphans(entries, new Set(['live']));
    expect(orphans.map((e) => e.sessionId)).toEqual(['dead']);
  });

  it('treats a non-recovered (e.g. non-tmux) session as an orphan', () => {
    const entries = [entry({ sessionId: 'headless', tmux: false })];
    expect(remoteReapOrphans(entries, new Set())).toHaveLength(1);
  });

  it('spares a tmux session that the renderer re-attached on restore', () => {
    const entries = [entry({ sessionId: 'tmux-a', tmux: true })];
    expect(remoteReapOrphans(entries, new Set(['tmux-a']))).toHaveLength(0);
  });
});

describe('createRemoteReapLedger', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reap-ledger-'));
    filePath = join(dir, 'remote-reap-ledger.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('records and lists entries', async () => {
    const ledger = createRemoteReapLedger({ filePath });
    await ledger.record(entry({ sessionId: 'a', pid: 1 }));
    await ledger.record(entry({ sessionId: 'b', pid: 2 }));
    const list = await ledger.list();
    expect(list.map((e) => e.sessionId).sort()).toEqual(['a', 'b']);
  });

  it('upserts by sessionId (no duplicate rows on a re-record)', async () => {
    const ledger = createRemoteReapLedger({ filePath });
    await ledger.record(entry({ sessionId: 'a', pid: 1 }));
    await ledger.record(entry({ sessionId: 'a', pid: 999 }));
    const list = await ledger.list();
    expect(list).toHaveLength(1);
    expect(list[0].pid).toBe(999);
  });

  it('removes a single entry', async () => {
    const ledger = createRemoteReapLedger({ filePath });
    await ledger.record(entry({ sessionId: 'a' }));
    await ledger.record(entry({ sessionId: 'b' }));
    await ledger.remove('a');
    expect((await ledger.list()).map((e) => e.sessionId)).toEqual(['b']);
  });

  it('removes many entries at once', async () => {
    const ledger = createRemoteReapLedger({ filePath });
    await ledger.record(entry({ sessionId: 'a' }));
    await ledger.record(entry({ sessionId: 'b' }));
    await ledger.record(entry({ sessionId: 'c' }));
    await ledger.removeMany(['a', 'c']);
    expect((await ledger.list()).map((e) => e.sessionId)).toEqual(['b']);
  });

  it('persists across a fresh ledger instance (survives a restart)', async () => {
    const first = createRemoteReapLedger({ filePath });
    await first.record(entry({ sessionId: 'a', pid: 7 }));
    const second = createRemoteReapLedger({ filePath });
    const list = await second.list();
    expect(list).toHaveLength(1);
    expect(list[0].pid).toBe(7);
  });

  it('serializes concurrent writes without losing entries', async () => {
    const ledger = createRemoteReapLedger({ filePath });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => ledger.record(entry({ sessionId: `s${i}`, pid: i })))
    );
    expect(await ledger.list()).toHaveLength(20);
  });

  it('returns an empty list for a corrupt file instead of throwing', async () => {
    writeFileSync(filePath, '{ not json');
    const ledger = createRemoteReapLedger({ filePath });
    await expect(ledger.list()).resolves.toEqual([]);
    // A subsequent write recovers the file to valid JSON.
    await ledger.record(entry({ sessionId: 'a' }));
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toHaveLength(1);
  });

  it('drops malformed rows on read', async () => {
    writeFileSync(filePath, JSON.stringify([entry({ sessionId: 'ok' }), { sessionId: 'bad' }]));
    const ledger = createRemoteReapLedger({ filePath });
    expect((await ledger.list()).map((e) => e.sessionId)).toEqual(['ok']);
  });

  it('records a tmux-backed entry that has no pid (reaped by tmux session name)', async () => {
    const ledger = createRemoteReapLedger({ filePath });
    await ledger.record({
      sessionId: 'tmux-a',
      target: 'user@box',
      probeOpts: ['-o', 'ServerAliveInterval=30'],
      tmuxName: 'cc-tmux-a',
      tmux: true,
      createdAt: 1000
    });
    const list = await ledger.list();
    expect(list).toHaveLength(1);
    expect(list[0].pid).toBeUndefined();
    expect(list[0].tmuxName).toBe('cc-tmux-a');
  });

  it('keeps a tmuxName-only row and drops a row carrying NEITHER pid nor tmuxName', async () => {
    const tmuxOnly = {
      sessionId: 'tmux-a',
      target: 'user@box',
      probeOpts: [] as string[],
      tmuxName: 'cc-tmux-a',
      tmux: true,
      createdAt: 1000
    };
    const neither = { sessionId: 'bad', target: 'user@box', probeOpts: [], tmux: true, createdAt: 1000 };
    writeFileSync(filePath, JSON.stringify([tmuxOnly, neither]));
    const ledger = createRemoteReapLedger({ filePath });
    expect((await ledger.list()).map((e) => e.sessionId)).toEqual(['tmux-a']);
  });
});
