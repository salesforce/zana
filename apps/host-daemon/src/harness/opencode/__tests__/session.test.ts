/**
 * OpenCodeTranscriptAdapter dispatch tests — proves a `remote` ref runs its
 * discovery/stats over ssh (via `remote-exec`) instead of the local db/binary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionStats } from '@zana-ai/zcc-domain/product';

const listRemote = vi.fn();
const readStatsRemote = vi.fn();
const readStatsLocalDb = vi.fn();
const readStatsLocalExport = vi.fn();

vi.mock('../remote-exec.js', () => ({
  listRemoteOpenCodeSessions: (...a: unknown[]) => listRemote(...a),
  readSessionStatsOpenCodeRemote: (...a: unknown[]) => readStatsRemote(...a)
}));

vi.mock('../transcript-reader.js', () => ({
  readLastAssistantTextOpenCode: vi.fn(),
  readSessionDigestOpenCode: vi.fn(),
  readSessionStatsOpenCode: (...a: unknown[]) => readStatsLocalDb(...a),
  readSessionStatsOpenCodeExport: (...a: unknown[]) => readStatsLocalExport(...a)
}));

import { OpenCodeTranscriptAdapter } from '../session.js';

const REMOTE = { host: 'devbox' };
const STATS: SessionStats = { files: [], queue: [] };

beforeEach(() => {
  listRemote.mockReset();
  readStatsRemote.mockReset();
  readStatsLocalDb.mockReset();
  readStatsLocalExport.mockReset();
});

describe('OpenCodeTranscriptAdapter remote dispatch', () => {
  const adapter = new OpenCodeTranscriptAdapter(() => 'opencode');

  it('resolves a remote native id from the remote session list (earliest match in cwd)', async () => {
    listRemote.mockResolvedValue([
      { id: 'ses_late', created: 3000, directory: '/w' },
      { id: 'ses_early', created: 2000, directory: '/w' },
      { id: 'ses_other', created: 2500, directory: '/elsewhere' }
    ]);
    const ref = { id: 't1', profile: 'opencode', cwd: '/w', createdAt: 1500, remote: REMOTE };
    const resolved = await adapter.resolve(ref);
    expect(resolved).toEqual({ id: 't1', nativeId: 'ses_early' });
    expect(listRemote).toHaveBeenCalledWith(REMOTE, '/w', 5);
  });

  it('filters out rows created before the spawn floor', async () => {
    listRemote.mockResolvedValue([{ id: 'ses_stale', created: 100, directory: '/w' }]);
    const ref = { id: 't1', profile: 'opencode', cwd: '/w', createdAt: 100_000, remote: REMOTE };
    expect(await adapter.resolve(ref)).toBeUndefined();
  });

  it('never throws on a remote list rejection — resolve degrades to undefined (SSH down)', async () => {
    listRemote.mockRejectedValue(new Error('ssh: connect to host devbox port 22: Connection refused'));
    const ref = { id: 't1', profile: 'opencode', cwd: '/w', createdAt: 1500, remote: REMOTE };
    await expect(adapter.resolve(ref)).resolves.toBeUndefined();
  });

  it('prefers an already-stamped openCodeSessionId over a remote list call', async () => {
    const ref = { id: 't1', profile: 'opencode', cwd: '/w', openCodeSessionId: 'ses_known', remote: REMOTE };
    const resolved = await adapter.resolve(ref);
    expect(resolved).toEqual({ id: 't1', nativeId: 'ses_known' });
    expect(listRemote).not.toHaveBeenCalled();
  });

  it('reads remote stats over ssh, never the local db/export', async () => {
    readStatsRemote.mockResolvedValue(STATS);
    const ref = { id: 't1', profile: 'opencode', cwd: '/w', remote: REMOTE };
    const stats = await adapter.readStats(ref, { nativeId: 'ses_abc' });
    expect(stats).toBe(STATS);
    expect(readStatsRemote).toHaveBeenCalledWith(REMOTE, 'ses_abc', { cwd: '/w' });
    expect(readStatsLocalDb).not.toHaveBeenCalled();
    expect(readStatsLocalExport).not.toHaveBeenCalled();
  });

  it('never throws on a remote stats rejection — readStats degrades to null (transient SSH error)', async () => {
    readStatsRemote.mockRejectedValue(new Error('ssh timeout'));
    const ref = { id: 't1', profile: 'opencode', cwd: '/w', remote: REMOTE };
    await expect(adapter.readStats(ref, { nativeId: 'ses_abc' })).resolves.toBeNull();
    expect(readStatsLocalDb).not.toHaveBeenCalled();
    expect(readStatsLocalExport).not.toHaveBeenCalled();
  });

  it('uses the local db path when the ref is not remote', async () => {
    readStatsLocalDb.mockResolvedValue(STATS);
    const ref = { id: 't1', profile: 'opencode', cwd: '/w' };
    const stats = await adapter.readStats(ref, { nativeId: 'ses_abc' });
    expect(stats).toBe(STATS);
    expect(readStatsLocalDb).toHaveBeenCalled();
    expect(readStatsRemote).not.toHaveBeenCalled();
  });
});
