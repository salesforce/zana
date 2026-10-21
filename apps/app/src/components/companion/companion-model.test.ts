import { describe, it, expect } from 'vitest';
import type { CompanionAgent, CompanionRequest, CompanionSnapshot } from '@zana-ai/zcc-domain/product';
import {
  ANSWERED_STORAGE_KEY,
  agentDot,
  agentStatusLabel,
  formatAge,
  formatUntil,
  groupAgents,
  pendingRequests,
  railIndicators,
  readAnswered,
  scheduleStatus,
  writeAnswered
} from './companion-model.js';

function memStorage(init?: string) {
  const m = new Map<string, string>(init ? [[ANSWERED_STORAGE_KEY, init]] : []);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const req = (over: Partial<CompanionRequest> & { id: string }): CompanionRequest =>
  ({ kind: 'question', projectId: 'p', projectName: 'P', agentTitle: 'A', prompt: '?', ts: 0, answerable: true, ...over }) as CompanionRequest;

const agent = (over: Partial<CompanionAgent> & { sessionId: string }): CompanionAgent =>
  ({ projectId: 'p', projectName: 'P', title: over.sessionId, state: 'idle', createdAt: 0, recentlyCompleted: false, ...over }) as CompanionAgent;

const snap = (counts: Partial<CompanionSnapshot['counts']>): CompanionSnapshot =>
  ({ theme: 'dark', edge: 'right', requests: [], agents: [], schedules: [], userInitials: 'PC',
    counts: { blocked: 0, working: 0, idle: 0, recentlyCompleted: 0, runningSchedules: 0, ...counts } }) as CompanionSnapshot;

describe('answered set (shared with the in-app inbox)', () => {
  it('reads the zustand persist envelope and tolerates garbage', () => {
    expect(readAnswered(memStorage('{"state":{"answeredIds":{"e1":true}},"version":1}'))).toEqual({ e1: true });
    expect(readAnswered(memStorage('not json'))).toEqual({});
    expect(readAnswered(null)).toEqual({});
  });

  it('merges an id and writes the same envelope', () => {
    const s = memStorage('{"state":{"answeredIds":{"e1":true}},"version":1}');
    expect(writeAnswered(s, 'e2')).toEqual({ e1: true, e2: true });
    expect(JSON.parse(s.m.get(ANSWERED_STORAGE_KEY)!)).toEqual({ state: { answeredIds: { e1: true, e2: true } }, version: 1 });
  });
});

describe('pendingRequests / groupAgents', () => {
  it('drops answered entries and dismissed ids', () => {
    const rs = [req({ id: 'inbox:e1', entryId: 'e1' }), req({ id: 'inbox:e2', entryId: 'e2' }), req({ id: 'agent:s1', kind: 'blocked' })];
    expect(pendingRequests(rs, { e1: true }, new Set(['agent:s1'])).map((r) => r.id)).toEqual(['inbox:e2']);
  });

  it('groups agents, counting askers as needing you', () => {
    const g = groupAgents(
      [agent({ sessionId: 'b', state: 'blocked' }), agent({ sessionId: 'w', state: 'working' }), agent({ sessionId: 'q', state: 'working' }), agent({ sessionId: 'i' })],
      [req({ id: 'inbox:x', sessionId: 'q' })]
    );
    expect(g.needsYou.map((a) => a.sessionId)).toEqual(['b', 'q']);
    expect(g.working.map((a) => a.sessionId)).toEqual(['w']);
    expect(g.idle.map((a) => a.sessionId)).toEqual(['i']);
  });
});

describe('rail indicators follow the legend', () => {
  it('red > yellow > green > nothing', () => {
    expect(railIndicators(snap({ working: 2 }), 1)).toEqual({ needsYou: 1, agents: 'attention', scheduler: null, status: 'attention' });
    expect(railIndicators(snap({ working: 2, runningSchedules: 1 }), 0)).toMatchObject({ agents: 'working', scheduler: 'working', status: 'working' });
    expect(railIndicators(snap({ recentlyCompleted: 1 }), 0).agents).toBe('done');
    expect(railIndicators(snap({}), 0)).toMatchObject({ needsYou: 0, agents: null, scheduler: null });
  });

  it('labels and dots per agent', () => {
    expect(agentDot({ state: 'waiting', recentlyCompleted: false })).toBe('cc-dot-attention');
    expect(agentDot({ state: 'working', recentlyCompleted: true })).toBe('cc-dot-working');
    expect(agentDot({ state: 'idle', recentlyCompleted: true })).toBe('cc-dot-done');
    expect(agentDot({ state: 'unknown', recentlyCompleted: false })).toBe('cc-dot-idle');
    expect(agentStatusLabel({ state: 'done', recentlyCompleted: true })).toBe('Completed');
    expect(agentStatusLabel({ state: 'blocked', recentlyCompleted: true })).toBe('Needs you');
    expect(agentStatusLabel({ state: 'unknown', recentlyCompleted: false })).toBe('Idle');
  });
});

describe('time formatting', () => {
  it('formats ages', () => {
    expect(formatAge(0, 10_000)).toBe('now');
    expect(formatAge(0, 4 * 60_000)).toBe('4m');
    expect(formatAge(0, 2 * 3600_000 + 5)).toBe('2h');
    expect(formatAge(0, 3 * 86_400_000)).toBe('3d');
    expect(formatAge(5000, 0)).toBe('now');
  });

  it('formats the next run', () => {
    const now = Date.parse('2026-10-05T10:00:00Z');
    expect(formatUntil(null, now)).toBeNull();
    expect(formatUntil('garbage', now)).toBeNull();
    expect(formatUntil('2026-10-05T10:00:30Z', now)).toBe('any moment');
    expect(formatUntil('2026-10-05T10:05:00Z', now)).toBe('in 5m');
    expect(formatUntil('2026-10-05T12:00:00Z', now)).toBe('in 2h');
    expect(formatUntil('2026-10-08T10:00:00Z', now)).toBe('in 3d');
  });
});

describe('scheduleStatus', () => {
  const now = Date.parse('2026-10-05T10:00:00Z');
  const base = { running: false, enabled: true, nextRunAt: '2026-10-05T12:00:00Z' as string | null };

  it('running / starting win over everything', () => {
    expect(scheduleStatus({ ...base, running: true, lastResult: 'error' }, now)).toBe('Running');
    expect(scheduleStatus({ ...base, lastResult: 'error' }, now, true)).toBe('Starting…');
  });

  it('surfaces a failed last run with its age and the next run', () => {
    expect(scheduleStatus({ ...base, lastResult: 'error', lastRunAt: '2026-10-05T08:00:00Z' }, now)).toBe('Last run failed 2h ago · next in 2h');
    expect(scheduleStatus({ ...base, enabled: false, lastResult: 'error', lastRunAt: '2026-10-05T09:59:50Z' }, now)).toBe('Last run failed just now');
    expect(scheduleStatus({ ...base, lastResult: 'error' }, now)).toBe('Last run failed · next in 2h');
  });

  it('paused, next run, or manual', () => {
    expect(scheduleStatus({ ...base, enabled: false }, now)).toBe('Paused');
    expect(scheduleStatus({ ...base, lastResult: 'success' }, now)).toBe('in 2h');
    expect(scheduleStatus({ ...base, nextRunAt: null }, now)).toBe('Manual');
  });
});
