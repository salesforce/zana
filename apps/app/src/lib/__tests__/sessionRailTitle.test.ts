import { describe, expect, it } from 'vitest';
import type { SessionCohort } from '@zana-ai/zcc-domain/product';
import { sessionRailTitle } from '../sessionRailTitle.js';

const cohort = (over: Partial<SessionCohort>): SessionCohort => ({
  cohortId: 'c1', teamId: 't1', teamName: 'Squad', role: 'worker', ...over
}) as SessionCohort;

describe('sessionRailTitle', () => {
  it('uses the job title for an orchestrator', () => {
    expect(sessionRailTitle({ title: 'Claude Code', cohort: cohort({ role: 'orchestrator', executionJobTitle: ' Fix login ' }) })).toBe('Fix login');
  });
  it('falls back to the session title for an orchestrator with a blank job title', () => {
    expect(sessionRailTitle({ title: 'Claude Code', cohort: cohort({ role: 'orchestrator', executionJobTitle: '  ' }) })).toBe('Claude Code');
  });
  it('keeps the worker own title even when a job title exists', () => {
    expect(sessionRailTitle({ title: 'Engineer', cohort: cohort({ role: 'worker', executionJobTitle: 'Fix login', slotLabel: 'Slot' }) })).toBe('Engineer');
  });
  it('falls back to slotLabel for a worker with a blank title', () => {
    expect(sessionRailTitle({ title: '  ', cohort: cohort({ role: 'worker', slotLabel: ' Engineer ' }) })).toBe('Engineer');
  });
  it('returns the title when there is no cohort', () => {
    expect(sessionRailTitle({ title: 'Plain' })).toBe('Plain');
  });
});
