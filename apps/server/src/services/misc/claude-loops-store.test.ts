import { describe, it, expect, vi } from 'vitest';

// app.getPath('home') is only used by the file-reading paths, which these tests
// don't exercise (they cover the pure mappers). Stub electron so the import is
// side-effect-free under vitest.
vi.mock('electron', () => ({ app: { getPath: () => '/home/test' } }));

const { cronToCadence, loopName, readClaudeLoops } = await import('./claude-loops-store.js');

describe('cronToCadence', () => {
  it('every N minutes', () => {
    expect(cronToCadence('*/5 * * * *')).toBe('every 5m');
    expect(cronToCadence('*/15 * * * *')).toBe('every 15m');
  });

  it('every N hours', () => {
    expect(cronToCadence('7 */2 * * *')).toBe('every 2h');
    expect(cronToCadence('0 */6 * * *')).toBe('every 6h');
  });

  it('hourly on a fixed minute', () => {
    expect(cronToCadence('7 * * * *')).toBe('every 1h');
  });

  it('every N days at a fixed time', () => {
    expect(cronToCadence('0 0 */3 * *')).toBe('every 3d');
  });

  it('daily and weekday pins', () => {
    expect(cronToCadence('30 9 * * *')).toBe('daily at 09:30');
    expect(cronToCadence('0 9 * * 1-5')).toBe('weekdays at 09:00');
  });

  it('falls back to the raw expression for exotic crons', () => {
    expect(cronToCadence('15,45 * * * *')).toBe('15,45 * * * *');
    expect(cronToCadence('not a cron')).toBe('not a cron');
    // A specific single weekday isn't one of the prettified forms.
    expect(cronToCadence('0 9 * * 3')).toBe('at 09:00 (dow 3)');
  });

  it('does not mislabel a stepped-minute + stepped-hour cron as "every Nh"', () => {
    // "*/5 */2 * * *" has BOTH a 5-min step and a 2-hour step; labeling it
    // "every 2h" would silently drop the minute step. Must fall through to raw.
    expect(cronToCadence('*/5 */2 * * *')).toBe('*/5 */2 * * *');
    // A fixed minute with a stepped hour is still the clean "every Nh" case.
    expect(cronToCadence('0 */2 * * *')).toBe('every 2h');
  });
});

describe('loopName', () => {
  it('extracts a slash command', () => {
    expect(loopName('/babysit-prs check the queue')).toBe('/babysit-prs');
    expect(loopName('/loop:foo')).toBe('/loop:foo');
  });

  it('uses the first line for a prose prompt', () => {
    expect(loopName('Supervise all my agents\nand report back')).toBe('Supervise all my agents');
  });

  it('truncates a long single-line prompt', () => {
    const long = 'x'.repeat(80);
    const out = loopName(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBe(58); // 57 chars + ellipsis
  });

  it('falls back to a default for an empty prompt', () => {
    expect(loopName('')).toBe('Claude loop');
  });
});

describe('readClaudeLoops', () => {
  it('falls back to now for an out-of-range createdAt instead of throwing', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'loops-'));
    try {
      mkdirSync(join(dir, '.claude'));
      writeFileSync(join(dir, '.claude', 'scheduled_tasks.json'), JSON.stringify({ tasks: [
        { id: 'bad', cron: '*/5 * * * *', prompt: 'check', createdAt: 1e300 },
        { id: 'ok', cron: '*/5 * * * *', prompt: 'check', createdAt: 0 }
      ] }));
      const rows = readClaudeLoops([{ id: 'p', name: 'P', path: dir, createdAt: 0, lastActiveAt: 0 }], '2026-01-01T00:00:00.000Z');
      expect(rows.map(row => [row.id, row.createdAt])).toEqual([
        ['claude-loop:bad', '2026-01-01T00:00:00.000Z'],
        ['claude-loop:ok', '1970-01-01T00:00:00.000Z']
      ]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
