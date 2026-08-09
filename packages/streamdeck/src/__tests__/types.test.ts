import { describe, it, expect } from 'vitest';
import {
  stateToDeckStatus,
  agentLabel,
  projectColor,
  nextRunEta,
  isScheduleRunning,
  type AgentListItem,
  type ScheduleItem
} from '../lib/types.js';

describe('stateToDeckStatus', () => {
  it('maps blocked → attention (red "needs you" glance tile)', () => {
    expect(stateToDeckStatus('blocked')).toBe('attention');
  });
  it('maps working → busy (its own yellow bucket, not the green "running" chrome)', () => {
    expect(stateToDeckStatus('working')).toBe('busy');
  });
  it('maps unknown → error (stale/unreachable is visibly distinct from idle)', () => {
    expect(stateToDeckStatus('unknown')).toBe('error');
  });
  it('maps idle → idle, done → done (its own teal bucket)', () => {
    expect(stateToDeckStatus('idle')).toBe('idle');
    expect(stateToDeckStatus('done')).toBe('done');
  });
});

describe('projectColor', () => {
  it('is stable for the same project id', () => {
    expect(projectColor('p-1')).toEqual(projectColor('p-1'));
  });
  it('returns an in-gamut RGB triple', () => {
    const [r, g, b] = projectColor('anything');
    for (const c of [r, g, b]) expect(c).toBeGreaterThanOrEqual(0), expect(c).toBeLessThanOrEqual(255);
  });
  it('never returns the alert red (reserved for the needs-you border)', () => {
    // Sample many ids; none should collide with the [244,67,54] alert colour.
    for (let i = 0; i < 200; i += 1) {
      expect(projectColor(`proj-${i}`)).not.toEqual([244, 67, 54]);
    }
  });
  it('distinguishes at least a few distinct projects', () => {
    const seen = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => projectColor(id).join(','))
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('nextRunEta', () => {
  const NOW = 1_700_000_000_000; // fixed clock so the maths is deterministic
  const sched = (nextRunAt?: string): ScheduleItem => ({
    id: 's',
    name: 'n',
    enabled: true,
    projectId: 'p',
    ...(nextRunAt ? { status: { nextRunAt } } : {})
  });
  const inMs = (ms: number) => new Date(NOW + ms).toISOString();

  it('renders "—" when there is no nextRunAt or it is unparseable', () => {
    expect(nextRunEta(sched(), NOW)).toBe('—');
    expect(nextRunEta(sched('not-a-date'), NOW)).toBe('—');
  });
  it('renders "due" when the fire time is now or in the past', () => {
    expect(nextRunEta(sched(inMs(0)), NOW)).toBe('due');
    expect(nextRunEta(sched(inMs(-5 * 60_000)), NOW)).toBe('due');
  });
  it('renders "<1m" for under a minute', () => {
    expect(nextRunEta(sched(inMs(30_000)), NOW)).toBe('<1m');
  });
  it('renders whole minutes under an hour', () => {
    expect(nextRunEta(sched(inMs(5 * 60_000)), NOW)).toBe('5m');
    expect(nextRunEta(sched(inMs(59 * 60_000)), NOW)).toBe('59m');
  });
  it('renders hours (and remainder minutes) under a day', () => {
    expect(nextRunEta(sched(inMs(2 * 3_600_000)), NOW)).toBe('2h');
    expect(nextRunEta(sched(inMs(2 * 3_600_000 + 15 * 60_000)), NOW)).toBe('2h 15m');
  });
  it('renders days (and remainder hours) beyond a day', () => {
    expect(nextRunEta(sched(inMs(24 * 3_600_000)), NOW)).toBe('1d');
    expect(nextRunEta(sched(inMs(27 * 3_600_000)), NOW)).toBe('1d 3h');
  });
});

describe('isScheduleRunning', () => {
  const base: ScheduleItem = { id: 's', name: 'n', enabled: true, projectId: 'p' };
  it('is true when the last run session is in the live set', () => {
    const s = { ...base, status: { lastRunSessionId: 'sess-1' } };
    expect(isScheduleRunning(s, new Set(['sess-1', 'sess-2']))).toBe(true);
  });
  it('is false when the session is not live, or there is no last run', () => {
    const s = { ...base, status: { lastRunSessionId: 'sess-9' } };
    expect(isScheduleRunning(s, new Set(['sess-1']))).toBe(false);
    expect(isScheduleRunning(base, new Set(['sess-1']))).toBe(false);
  });
});

describe('agentLabel', () => {
  const base: AgentListItem = { sessionId: 's', projectId: 'p', cwd: '/', state: 'idle' };
  it('prefers displayName (matches the app Kanban title), then handle, then sessionId', () => {
    // displayName wins so the deck caption equals the app card's session.title.
    expect(agentLabel({ ...base, handle: 'h', displayName: 'd' })).toBe('d');
    // handle is the fallback for a registered-but-untitled agent…
    expect(agentLabel({ ...base, handle: 'h' })).toBe('h');
    // …and sessionId the last resort.
    expect(agentLabel(base)).toBe('s');
  });
});
