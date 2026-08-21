import { describe, it, expect, vi } from 'vitest';

// followup-store imports `electron` for `app.getPath('home')` in globalDir().
// The validator under test doesn't touch it; mocking keeps import-time happy.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cc-test-home' }
}));

import { validateFollowUpFile } from './followup-store.js';

const base = {
  id: 'fu-1',
  projectId: 'proj-1',
  title: 'Should I commit these changes?',
  detail: 'Working tree has 4 files staged.',
  kind: 'question',
  status: 'open',
  origin: { source: 'idle-triage', sessionId: 's-1', confidence: 0.8 },
  sessionId: 's-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

describe('validateFollowUpFile', () => {
  it('accepts a valid follow-up and round-trips fields', () => {
    const r = validateFollowUpFile({ ...base });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.id).toBe('fu-1');
    expect(r.title).toBe('Should I commit these changes?');
    expect(r.kind).toBe('question');
    expect(r.status).toBe('open');
    expect(r.origin).toEqual({ source: 'idle-triage', sessionId: 's-1', confidence: 0.8 });
    expect(r.sessionId).toBe('s-1');
  });

  it('round-trips a clean options list, trimming and dropping empties', () => {
    const r = validateFollowUpFile({ ...base, options: ['  Tag now ', '', 'Wait', 42] });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.options).toEqual(['Tag now', 'Wait']);
  });

  it('drops options entirely when absent or all-empty', () => {
    const none = validateFollowUpFile({ ...base });
    if ('error' in none) throw new Error('unexpected error');
    expect(none.options).toBeUndefined();

    const empty = validateFollowUpFile({ ...base, options: ['   ', ''] });
    if ('error' in empty) throw new Error('unexpected error');
    expect(empty.options).toBeUndefined();
  });

  it('round-trips spawnedAt when present, drops a non-string one', () => {
    const withStamp = validateFollowUpFile({ ...base, spawnedAt: '2026-01-02T00:00:00.000Z' });
    if ('error' in withStamp) throw new Error('unexpected error');
    expect(withStamp.spawnedAt).toBe('2026-01-02T00:00:00.000Z');

    const bad = validateFollowUpFile({ ...base, spawnedAt: 123 });
    if ('error' in bad) throw new Error('unexpected error');
    expect(bad.spawnedAt).toBeUndefined();
  });

  it('round-trips dedupeKey/occurrences and drops invalid ones', () => {
    const ok = validateFollowUpFile({ ...base, dedupeKey: 'agent:s-1:commit', occurrences: 3 });
    if ('error' in ok) throw new Error('unexpected error');
    expect(ok.dedupeKey).toBe('agent:s-1:commit');
    expect(ok.occurrences).toBe(3);

    // Empty/blank key, and occurrences <= 1 or non-finite, normalize to undefined.
    const bad = validateFollowUpFile({ ...base, dedupeKey: '  ', occurrences: 1 });
    if ('error' in bad) throw new Error('unexpected error');
    expect(bad.dedupeKey).toBeUndefined();
    expect(bad.occurrences).toBeUndefined();

    const nan = validateFollowUpFile({ ...base, occurrences: Number.NaN });
    if ('error' in nan) throw new Error('unexpected error');
    expect(nan.occurrences).toBeUndefined();
  });

  it('trims the title', () => {
    const r = validateFollowUpFile({ ...base, title: '  hi  ' });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.title).toBe('hi');
  });

  it.each([
    ['missing id', (g: Record<string, unknown>) => delete g.id],
    ['missing title', (g: Record<string, unknown>) => delete g.title],
    ['missing projectId', (g: Record<string, unknown>) => delete g.projectId],
    ['blank title', (g: Record<string, unknown>) => (g.title = '   ')]
  ])('rejects %s', (_label, mutate) => {
    const g = { ...base } as Record<string, unknown>;
    mutate(g);
    expect('error' in validateFollowUpFile(g)).toBe(true);
  });

  it('rejects a non-object', () => {
    expect('error' in validateFollowUpFile(null)).toBe(true);
    expect('error' in validateFollowUpFile('nope')).toBe(true);
  });

  it('defaults an unknown status to open and unknown kind to question', () => {
    const r = validateFollowUpFile({ ...base, status: 'vibing', kind: 'rant' });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.status).toBe('open');
    expect(r.kind).toBe('question');
  });

  it('falls back to a user origin when origin is missing or malformed', () => {
    const r = validateFollowUpFile({ ...base, origin: undefined, sessionId: undefined });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.origin).toEqual({ source: 'user' });
    expect(r.sessionId).toBeUndefined();
  });

  it('clamps an idle-triage origin confidence into 0..1', () => {
    const hi = validateFollowUpFile({ ...base, origin: { source: 'idle-triage', sessionId: 's', confidence: 9 } });
    if ('error' in hi) throw new Error('unexpected error');
    expect(hi.origin).toEqual({ source: 'idle-triage', sessionId: 's', confidence: 1 });
    const lo = validateFollowUpFile({ ...base, origin: { source: 'idle-triage', sessionId: 's', confidence: -3 } });
    if ('error' in lo) throw new Error('unexpected error');
    if (lo.origin.source !== 'idle-triage') throw new Error('expected idle-triage');
    expect(lo.origin.confidence).toBe(0);
  });

  it('drops an agent origin with no sessionId back to user', () => {
    const r = validateFollowUpFile({ ...base, origin: { source: 'agent' }, sessionId: undefined });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.origin).toEqual({ source: 'user' });
  });

  it('synthesizes timestamps when absent', () => {
    const r = validateFollowUpFile({
      id: 'x',
      projectId: 'p',
      title: 'T'
    });
    if ('error' in r) throw new Error('unexpected error');
    expect(typeof r.createdAt).toBe('string');
    expect(typeof r.updatedAt).toBe('string');
    expect(r.status).toBe('open');
    expect(r.kind).toBe('question');
    expect(r.origin).toEqual({ source: 'user' });
  });
});
