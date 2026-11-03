import { describe, expect, it } from 'vitest';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import type { AgentCard } from '../components/AgentBoard.js';
import { agentFleetItem, threadFleetItem, scheduleFleetItem } from '../components/fleet-item.js';
import type { ThreadListItem } from '../thread-store.js';
import type { ScheduledTask, ExecutionBoardProjection } from '@zana-ai/zcc-domain/product';
import { agentsViewKey, projectAgentsView, resolveAgentsView } from './agents-view-model.js';
import { interpretPluginApp, clearPluginSlots, listAgentsViews } from './plugin-slots.js';

function card(id: string, state = 'working', extra = {}): ReturnType<typeof agentFleetItem> {
  return agentFleetItem({ projectId: 'p', projectName: 'Project', state, liveSubagents: 0, session: { id, title: id, status: 'running', ...extra } } as AgentCard);
}
const job = { projectId: 'p', executionId: 'j', jobTitle: 'Job', state: 'RUNNING' } as ExecutionBoardProjection;

describe('Agents plugin view registration', () => {
  it('stamps identity, replaces generations, keeps snapshots stable and falls back when removed', () => {
    const definition = definePluginApp((app) => app.slots.experimental_agentsView({ id: 'world', title: 'World', icon: 'Building2', component: () => null }));
    const first = interpretPluginApp('city-test', definition);
    expect(first.agentsViews[0]).toMatchObject({ pluginId: 'city-test', generation: first.generation });
    const key = agentsViewKey(first.agentsViews[0]);
    expect(resolveAgentsView(key, listAgentsViews())).toBe(key);
    expect(listAgentsViews()).toBe(listAgentsViews());
    const next = interpretPluginApp('city-test', definition);
    expect(next.generation).toBeGreaterThan(first.generation);
    expect(listAgentsViews().filter((s) => s.pluginId === 'city-test')).toHaveLength(1);
    clearPluginSlots('city-test');
    expect(resolveAgentsView(key, listAgentsViews())).toBe('board');
    expect(resolveAgentsView('flow', [])).toBe('flow');
  });
  it.each([{ id: '../bad', title: 'World', component: () => null }, { id: 'world', title: '', component: () => null }, { id: 'world', title: 'World', component: null }, { id: 'world', title: 'World', component: () => null, icon: '' }])('rejects malformed registration', (registration) => {
    expect(() => interpretPluginApp('bad-test', definePluginApp((app) => app.slots.experimental_agentsView(registration as never)))).toThrow();
  });
  it('rejects duplicate slots', () => {
    expect(() => interpretPluginApp('duplicate-test', definePluginApp((app) => {
      for (let i = 0; i < 2; i++) app.slots.experimental_agentsView({ id: 'world', title: 'World', component: () => null });
    }))).toThrow(/Duplicate/i);
  });
});

describe('Live fleet projection', () => {
  it('projects the real harness consistently for threads, CLI profiles and scheduled plans', () => {
    const thread = threadFleetItem({ id: 'thread', projectId: 'p', providerId: 'acp-opencode', status: 'idle' } as ThreadListItem);
    const schedule = scheduleFleetItem({ id: 's', name: 'Plan', projectId: 'p', profile: 'cursor-yolo', enabled: true } as ScheduledTask);
    const result = projectAgentsView([thread, card('cli', 'idle', { profile: 'codex-yolo' }), schedule], [], 'medium');
    expect(result.members.map((m) => m.harness)).toEqual(['OpenCode', 'Codex']);
    expect(result.schedules[0].harness).toBe('Cursor');
  });
  it('keeps unknown, idle, exited and failed distinct; background blockers never nag the user', () => {
    const result = projectAgentsView([
      card('work'), card('ask', 'blocked'), card('background', 'blocked', { headless: true }),
      card('scheduled', 'blocked', { scheduled: true }), card('idle', 'idle'), card('unknown', 'unknown'),
      card('done', 'done', { status: 'exited', exitCode: 0 }), card('bad', 'done', { status: 'exited', exitCode: 2 }),
      card('unproven', 'done', { status: 'exited' })
    ], [], 'medium');
    expect(result.members.map((m) => m.status)).toEqual(['working', 'needs-you', 'working', 'working', 'idle', 'unknown', 'done', 'error', 'done']);
    expect(result.members[2].detail).toContain('background agent blocked');
    expect(result.members[3].scheduled).toBe(true);
    expect(result.members[8]).toMatchObject({ live: false, detail: 'Exited · outcome unknown' });
  });
  it('uses real thread status and preserves team membership without manufacturing members', () => {
    const threads = ['active', 'idle', 'error'].map((status) => threadFleetItem({ id: status, projectId: 'p', title: status, status } as ThreadListItem));
    threads.push(threadFleetItem({ id: 'ask', projectId: 'p', status: 'idle', hasPendingInteraction: true } as ThreadListItem));
    const result = projectAgentsView([...threads, card('team', 'working', { cohort: { cohortId: 'co', executionId: 'j' } })], [job], 'low');
    expect(result.members.map((m) => m.status)).toEqual(['working', 'idle', 'error', 'needs-you', 'working']);
    expect(result.members[4].teamId).toBe('j');
    expect(result.executions).toEqual([{ key: 'execution:p:j', projectId: 'p', title: 'Job', state: 'RUNNING', needsAttention: false }]);
  });
  it('separates upcoming plans from sessions and marks a running schedule once', () => {
    const schedule = (id: string, enabled: boolean, session?: string) => scheduleFleetItem({ id, name: id, projectId: 'p', enabled, status: { lastRunSessionId: session, nextRunAt: '2026-10-03T18:00:00Z' } } as ScheduledTask);
    const result = projectAgentsView([card('run', 'working', { scheduled: true }), schedule('active', true, 'run'), schedule('paused', false), schedule('waiting', true, 'old')], [], 'high');
    expect(result.members).toHaveLength(1);
    expect(result.schedules.map((s) => [s.running, s.nextRunAt])).toEqual([[true, '2026-10-03T18:00:00Z'], [false, null], [false, '2026-10-03T18:00:00Z']]);
  });
});

it('does not count a finished-but-open scheduled run as actively running, but finds an overlapping older run', () => {
  const make = (older: boolean) => scheduleFleetItem({ id: 's', name: 'Plan', projectId: 'p', enabled: true, status: { lastRunSessionId: 'new', runs: [
    { sessionId: 'new', finishedAt: '2026-10-03T18:00:00Z' }, ...(older ? [{ sessionId: 'old' }] : [])
  ] } } as ScheduledTask);
  const sessions = [card('new', 'idle', { scheduled: true }), card('old', 'working', { scheduled: true })];
  expect(projectAgentsView([...sessions, make(false)], [], 'medium').schedules[0].running).toBe(false);
  expect(projectAgentsView([...sessions, make(true)], [], 'medium').schedules[0].running).toBe(true);
});

it('still reads a schedule as running when its newest row is an overlap skip without a session and an older row is live', () => {
  const schedule = scheduleFleetItem({ id: 's', name: 'Plan', projectId: 'p', enabled: true, status: { runs: [
    { id: 'skip', at: '2026-10-03T18:00:00Z', result: 'skipped', reasonCode: 'overlap', slotAt: '2026-10-03T18:00:00Z' },
    { id: 'live', at: '2026-10-03T17:00:00Z', sessionId: 'live', result: 'success' }
  ] } } as ScheduledTask);
  const running = (live: boolean) => projectAgentsView([...(live ? [card('live', 'working', { scheduled: true })] : []), schedule], [], 'medium').schedules[0].running;
  expect(running(true)).toBe(true);
  expect(running(false)).toBe(false);
});
