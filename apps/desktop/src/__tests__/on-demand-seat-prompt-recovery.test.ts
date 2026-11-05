import { describe, expect, it } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';
import { jobCoordinatorPrompt, type RosterEntry } from '../team-coordinator-prompt.js';
import { createDesktopNativeRecovery } from '../team-launch-support.js';

const team: Team = { id: 't', name: 'Doc Squad', description: 'x', orchestratorPersonaId: 'lead', slots: [{ personaId: 'lead' }], source: 'builtin' } as never;
const prompt = (roster: RosterEntry[]) =>
  jobCoordinatorPrompt({ team, executionId: 'e', job: { objective: 'Ship' }, roster, planReady: false });

describe('coordinator roster with seats that start on demand (#580)', () => {
  it('lists running seats as before when none is deferred', () => {
    const text = prompt([{ sessionId: 's-1', slotId: '0:w:0', label: 'Worker' }]);
    expect(text).toContain('Workers are already running:\n- Worker — session `s-1`, slot `0:w:0`');
    expect(text).not.toContain('start when their first unit is ready');
  });

  it('adds a separate list for seats that are not running yet, without a session id', () => {
    const text = prompt([{ sessionId: 's-1', slotId: '1:v:0', label: 'Builder' }, { slotId: '0:w:0', label: 'Reviewer', startsWhenNeeded: true }]);
    expect(text).toContain('- Builder — session `s-1`, slot `1:v:0`');
    expect(text).toContain('Seats that start when their first unit is ready (not running yet, so no session id):\n- Reviewer, slot `0:w:0`');
    expect(text).toContain('Do not message them or wait for them to appear');
  });

  it('says nothing is running yet when every worker waits, and still says No workers for an empty roster', () => {
    expect(prompt([{ slotId: '0:w:0', label: 'Reviewer', startsWhenNeeded: true }])).toContain('- No workers are running yet.');
    expect(prompt([])).toContain('- No workers.');
  });
});

describe('exact-native Resume totals with on-demand seats (#580)', () => {
  const snap = (slotId: string) => ({ slotId, role: 'worker', personaId: 'pe', profileId: 'claude', nativeConversationId: 'n' });
  const api = (slots: Array<{ startOnDemand?: boolean }>, expanded: string[], neverStartedSlots?: (record: never) => string[]) => createDesktopNativeRecovery({
    projects: { listProjects: () => [{ id: 'pr' }] as never },
    teams: { list: () => [{ id: 't', slots }] as never },
    personas: { list: () => [{ id: 'pe' }] as never },
    expandTeamSlots: () => expanded.map((slotId) => ({ slotId, role: 'worker' as const, personaId: 'pe' })),
    resolveTeamProfile: () => 'claude' as never,
    ...(neverStartedSlots ? { neverStartedSlots } : {})
  });

  it('without a lifecycle record, an on-demand seat with a snapshot counts and one without does not', () => {
    const recovery = api([{ startOnDemand: true }, {}], ['0:pe:0', '1:pe:0']);
    expect(recovery.totalSlots({ teamId: 't', nativeRecoverySnapshots: [snap('0:pe:0'), snap('1:pe:0')] } as never)).toBe(2);
    expect(recovery.totalSlots({ teamId: 't', nativeRecoverySnapshots: [snap('1:pe:0')] } as never)).toBe(1);
    expect(recovery.totalSlots({ teamId: 't' } as never)).toBe(1);
  });

  it('Q4: a seat that started but left no snapshot still counts, so Resume is not offered for a worker that would start cold', () => {
    const recovery = api([{ startOnDemand: true }, {}], ['0:pe:0', '1:pe:0'], () => []);
    const record = { projectId: 'pr', teamId: 't', nativeRecoverySnapshots: [snap('1:pe:0')] } as never;
    expect(recovery.totalSlots(record)).toBe(2);
    expect(recovery.availability(record)).toMatchObject({ available: false, reason: 'PARTIAL_RESTORE' });
  });

  it('Q4: a seat the lifecycle says never started is left out of the total, so Resume stays available', () => {
    const recovery = api([{ startOnDemand: true }, {}], ['0:pe:0', '1:pe:0'], () => ['0:pe:0']);
    const record = { projectId: 'pr', teamId: 't', nativeRecoverySnapshots: [snap('1:pe:0')] } as never;
    expect(recovery.totalSlots(record)).toBe(1);
    expect(recovery.availability(record)).toEqual({ available: true, restorableSlots: 1, totalSlots: 1 });
  });

  it('a lifecycle report only matters for on-demand rows', () => {
    const recovery = api([{}, {}], ['0:pe:0', '1:pe:0'], () => ['0:pe:0']);
    expect(recovery.totalSlots({ teamId: 't' } as never)).toBe(2);
  });

  it('does not know the total for an unknown team', () => {
    expect(api([{}], ['0:pe:0']).totalSlots({ teamId: 'other' } as never)).toBeUndefined();
  });
});
