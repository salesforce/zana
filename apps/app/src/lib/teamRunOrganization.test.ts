import { describe, expect, it } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { groupSessionsByTeamRun, projectNavigationSessions } from './teamRunOrganization.js';

function session(id: string, cohort?: TerminalSession['cohort']): TerminalSession {
  return { id, title: id, profile: 'claude', status: 'running', cohort } as TerminalSession;
}

const run = (cohortId: string, role: 'orchestrator' | 'worker', executionId?: string): NonNullable<TerminalSession['cohort']> => ({
  cohortId,
  teamId: 'team-1',
  teamName: 'Review Team',
  role,
  ...(executionId ? { executionId, executionJobTitle: 'Review auth' } : {})
});

describe('groupSessionsByTeamRun', () => {
  it('keeps concurrent launches of one Team separate', () => {
    const groups = groupSessionsByTeamRun([
      { session: session('lead-1', run('run-1', 'orchestrator')) },
      { session: session('worker-1', run('run-1', 'worker')) },
      { session: session('lead-2', run('run-2', 'orchestrator')) }
    ]);
    expect(groups.map((group) => group.key)).toEqual(['run:run-1', 'run:run-2']);
    expect(groups[0]?.items).toHaveLength(2);
  });
});

describe('projectNavigationSessions', () => {
  it('hides workers only in Team-runs mode', () => {
    const sessions = [
      session('lead', run('run-1', 'orchestrator')),
      session('worker', run('run-1', 'worker')),
      session('solo')
    ];
    expect(projectNavigationSessions(sessions, 'sessions')).toHaveLength(3);
    expect(projectNavigationSessions(sessions, 'team-runs').map(({ id }) => id)).toEqual(['lead', 'solo']);
  });
});
