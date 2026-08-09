import { describe, it, expect } from 'vitest';
import type { SessionCohort, TerminalSession } from '@shared/types';
import { buildLiveCohorts } from '../components/CohortBar';
import type { AgentCard } from '../components/AgentBoard';

/**
 * buildLiveCohorts is the renderer half of the Team cohort feature: it groups the
 * board's cards into live team launches (one per cohortId), counts live/idle
 * members, finds the orchestrator, and — crucially — DROPS a cohort whose every
 * member has exited (that team run is over). These guard that grouping so the
 * "Live teams" bar can't show a dead cohort or miscount its idle members (which
 * feeds the per-cohort Close-idle action).
 */

function card(
  over: Partial<AgentCard> & { state: AgentCard['state'] },
  cohort?: SessionCohort,
  status: TerminalSession['status'] = 'running'
): AgentCard {
  const session = {
    id: Math.random().toString(36).slice(2),
    status,
    profile: 'claude',
    title: 'agent',
    cohort
  } as unknown as TerminalSession;
  return {
    session,
    projectId: 'p1',
    projectName: 'P1',
    liveSubagents: 0,
    ...over
  };
}

const COHORT_A: SessionCohort = {
  cohortId: 'c-a',
  teamId: 'squad',
  teamName: 'Review Squad',
  role: 'worker'
};

describe('buildLiveCohorts', () => {
  it('ignores cards with no cohort stamp', () => {
    const out = buildLiveCohorts([card({ state: 'idle' }), card({ state: 'working' })]);
    expect(out).toHaveLength(0);
  });

  it('groups a launch into one cohort and counts live + idle members', () => {
    const cards = [
      card({ state: 'working' }, { ...COHORT_A, role: 'orchestrator' }),
      card({ state: 'idle' }, { ...COHORT_A, role: 'worker' }),
      card({ state: 'idle' }, { ...COHORT_A, role: 'worker' })
    ];
    const out = buildLiveCohorts(cards);
    expect(out).toHaveLength(1);
    expect(out[0].cohortId).toBe('c-a');
    expect(out[0].teamName).toBe('Review Squad');
    expect(out[0].liveCount).toBe(3);
    expect(out[0].idleCount).toBe(2);
    expect(out[0].orchestrator).toBeTruthy();
  });

  it('drops a cohort whose every member has exited (the run is over)', () => {
    const cards = [
      card({ state: 'idle' }, { ...COHORT_A, role: 'orchestrator' }, 'exited'),
      card({ state: 'idle' }, { ...COHORT_A, role: 'worker' }, 'exited')
    ];
    expect(buildLiveCohorts(cards)).toHaveLength(0);
  });

  it('keeps a cohort with at least one live member, but excludes exited from liveCount', () => {
    const cards = [
      card({ state: 'working' }, { ...COHORT_A, role: 'orchestrator' }),
      card({ state: 'idle' }, { ...COHORT_A, role: 'worker' }, 'exited')
    ];
    const out = buildLiveCohorts(cards);
    expect(out).toHaveLength(1);
    expect(out[0].liveCount).toBe(1);
    // An exited session is never an idle close-idle target.
    expect(out[0].idleCount).toBe(0);
  });

  it("doesn't set orchestrator when the orchestrator session has exited", () => {
    const cards = [
      card({ state: 'idle' }, { ...COHORT_A, role: 'orchestrator' }, 'exited'),
      card({ state: 'working' }, { ...COHORT_A, role: 'worker' })
    ];
    const out = buildLiveCohorts(cards);
    expect(out).toHaveLength(1);
    expect(out[0].orchestrator).toBeUndefined();
  });

  it('separates two distinct launches of the same team into two cohorts', () => {
    const cards = [
      card({ state: 'working' }, { ...COHORT_A, cohortId: 'c-1' }),
      card({ state: 'working' }, { ...COHORT_A, cohortId: 'c-2' })
    ];
    const out = buildLiveCohorts(cards);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.cohortId)).toEqual(['c-1', 'c-2']);
  });
});
