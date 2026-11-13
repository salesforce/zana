import { describe, expect, it } from 'vitest';
import { boundSyncError, classifyDelivery, diagnoseFault, isOfflineSyncError, isStageToken, MAX_SYNC_ERROR_LENGTH } from './sync-classify.js';

describe('classifyDelivery', () => {
  it('is waiting for no error, stage tokens and offline errors; failed for anything else', () => {
    for (const message of [null, undefined, '', 'conflict', 'received', 'blocked', 'peer grant unavailable', 'request timed out', 'ECONNRESET']) {
      expect(classifyDelivery(message)).toBe('waiting');
    }
    for (const message of ['receiver rejected it', 'peer request failed: 409', 'peer request failed: 500: boom']) {
      expect(classifyDelivery(message)).toBe('failed');
    }
  });
  it('agrees with isOfflineSyncError and isStageToken', () => {
    expect(isOfflineSyncError('not connected')).toBe(true);
    expect(isStageToken('merged')).toBe(true);
    expect(isStageToken('merged soon')).toBe(false);
    expect(isStageToken(null)).toBe(false);
  });
});

describe('diagnoseFault', () => {
  it('names a revoked or changed pairing, and a missing grant, and nothing else', () => {
    expect(diagnoseFault('peer enrollment changed or revoked')).toMatchObject({ code: 'enrollment' });
    expect(diagnoseFault('peer enrollment changed')).toMatchObject({ code: 'enrollment' });
    expect(diagnoseFault('peer grant unavailable')).toMatchObject({ code: 'grant' });
    expect(diagnoseFault('peer request failed: 409')).toBeNull();
    expect(diagnoseFault(null)).toBeNull();
    expect(diagnoseFault('')).toBeNull();
  });
  it('enrollment advice says restart may clear it, else pair again; grant advice says Sync Now retries', () => {
    expect(diagnoseFault('peer enrollment changed or revoked')!.hint).toMatch(/after Zana restarts.*pair the two computers again/);
    expect(diagnoseFault('peer grant unavailable')!.hint).toMatch(/Sync Now retries/);
  });
});

describe('boundSyncError', () => {
  it('redacts credentials and query strings', () => {
    const text = boundSyncError('failed https://h/x?token=SECRET&a=1 Authorization: Bearer abc123456789 password=hunter2 {"api_key":"KEY999"}');
    expect(text).not.toMatch(/SECRET|abc123456789|hunter2|KEY999|a=1/);
    expect(text).toContain('[redacted]');
  });
  it('collapses whitespace and truncates at the limit', () => {
    expect(boundSyncError('a \n\n b')).toBe('a b');
    const long = boundSyncError('y'.repeat(1000));
    expect(long.length).toBe(MAX_SYNC_ERROR_LENGTH);
    expect(long.endsWith('…')).toBe(true);
    expect(boundSyncError('short')).toBe('short');
  });
});
