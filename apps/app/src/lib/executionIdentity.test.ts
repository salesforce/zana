import { describe, expect, it } from 'vitest';
import { shortRunId, teamRunLabel } from './executionIdentity.js';

describe('shortRunId', () => {
  it('uses a distinctive trailing suffix instead of a shared UUID prefix', () => {
    expect(shortRunId('execution-11111111-2222-3333-4444-abcdef123456')).toBe('ef123456');
  });
});

describe('teamRunLabel', () => {
  it('uses canonical execution title and concrete execution suffix', () => {
    expect(teamRunLabel({
      cohortId: 'cohort-ignored',
      executionId: 'execution-abcdef123456',
      executionJobTitle: 'Fix login',
      teamName: 'Review Team'
    })).toBe('Fix login · Review Team · Run ef123456');
  });

  it('falls back to Team name and cohort identity', () => {
    expect(teamRunLabel({ cohortId: 'cohort-12345678', teamName: 'Review Team' }))
      .toBe('Review Team · Run 12345678');
  });
});
