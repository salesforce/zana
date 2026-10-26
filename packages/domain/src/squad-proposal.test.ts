import { describe, expect, it } from 'vitest';
import { toTeamSummary, type Team } from './product.js';
import {
  SQUAD_GOAL_MAX_CHARS,
  SQUAD_LIMIT_COUNTER_FROM,
  SQUAD_LIMIT_COUNTER_RATIO,
  SQUAD_PROPOSAL_LIMITS,
  SQUAD_SUMMARY_MAX_CHARS,
  formatSquadChars,
  isLaunchApproval,
  personaCanWriteFiles,
  planningToCoordinationMode,
  resolveLaunchApproval,
  squadGoalTooLongMessage,
  squadLaunchTextProblem,
  squadStoredFieldTooLong,
  squadSummaryTooLongMessage
} from './squad-proposal.js';

describe('personaCanWriteFiles', () => {
  it.each([
    ['denied Write/Edit/NotebookEdit/Bash', { deniedTools: ['Write', 'Edit', 'NotebookEdit', 'Bash'] }],
    ['denied plus mcp tool', { deniedTools: ['Write', 'Edit', 'NotebookEdit', 'Bash', 'mcp__zana'] }],
    ['only Write denied', { deniedTools: ['Write'] }],
    ['only Edit denied', { deniedTools: ['Edit'] }],
    ['permissionMode plan', { permissionMode: 'plan' as const }],
    ['executionState plan', { executionState: 'plan' as const }],
    ['codexSandbox read-only', { codexSandbox: 'read-only' as const }]
  ])('is false for %s', (_name, p) => {
    expect(personaCanWriteFiles(p)).toBe(false);
  });

  it.each([
    ['path-scoped denies only', { deniedTools: ['Write(~/.zcc/**)', 'Edit(~/.zcc/**)', 'Bash(git push:*)'] }],
    ['empty persona', {}],
    ['workspace-write sandbox', { codexSandbox: 'workspace-write' as const, permissionMode: 'default' as const }]
  ])('is true for %s', (_name, p) => {
    expect(personaCanWriteFiles(p)).toBe(true);
  });
});

describe('planningToCoordinationMode', () => {
  it('maps infer to freeform and provided to structured', () => {
    expect(planningToCoordinationMode('infer')).toBe('freeform');
    expect(planningToCoordinationMode('provided')).toBe('structured');
  });
});

describe('SQUAD_PROPOSAL_LIMITS', () => {
  it('has the agreed values', () => {
    expect(SQUAD_PROPOSAL_LIMITS).toEqual({
      goalChars: 2048,
      titleChars: 256,
      summaryChars: 2048,
      maxSources: 16,
      planTextBytes: 1_048_576,
      maxPendingPerProject: 20,
      maxRecords: 200,
      ttlMs: 604_800_000,
      reportChars: 2048,
      ptyQuietMs: 30_000,
      ptyQueueMax: 10
    });
  });
});

describe('toTeamSummary defaultPlanning', () => {
  const team = { id: 't', name: 'T', slots: [] } as unknown as Team;

  it('copies defaultPlanning only when set', () => {
    expect(toTeamSummary({ ...team, defaultPlanning: 'provided' })).toMatchObject({ defaultPlanning: 'provided' });
    expect('defaultPlanning' in toTeamSummary(team)).toBe(false);
  });

  it('copies launchApproval only when set', () => {
    expect(toTeamSummary({ ...team, launchApproval: 'review' })).toMatchObject({ launchApproval: 'review' });
    expect('launchApproval' in toTeamSummary(team)).toBe(false);
  });
});

describe('resolveLaunchApproval', () => {
  it('defaults to direct when neither side sets it', () => {
    expect(resolveLaunchApproval({})).toBe('direct');
    expect(resolveLaunchApproval({ squad: null, project: undefined })).toBe('direct');
    expect(resolveLaunchApproval({ squad: {}, project: {} })).toBe('direct');
  });

  it('uses the project setting when the squad has none', () => {
    expect(resolveLaunchApproval({ squad: {}, project: { launchApproval: 'review' } })).toBe('review');
  });

  it('treats review as a floor: a squad cannot lift project review', () => {
    expect(resolveLaunchApproval({ squad: { launchApproval: 'direct' }, project: { launchApproval: 'review' } })).toBe('review');
  });

  it('lets a squad require review when the project is direct or unset', () => {
    expect(resolveLaunchApproval({ squad: { launchApproval: 'review' }, project: { launchApproval: 'direct' } })).toBe('review');
    expect(resolveLaunchApproval({ squad: { launchApproval: 'review' }, project: {} })).toBe('review');
  });

  it('is direct when both sides say direct', () => {
    expect(resolveLaunchApproval({ squad: { launchApproval: 'direct' }, project: { launchApproval: 'direct' } })).toBe('direct');
  });
});

describe('isLaunchApproval', () => {
  it('accepts only review and direct', () => {
    expect(isLaunchApproval('review')).toBe(true);
    expect(isLaunchApproval('direct')).toBe(true);
    expect(isLaunchApproval('now')).toBe(false);
    expect(isLaunchApproval(undefined)).toBe(false);
  });
});

describe('shared Squad goal and summary limit', () => {
  it('keeps the proposal limits on the shared constants', () => {
    expect(SQUAD_PROPOSAL_LIMITS.goalChars).toBe(SQUAD_GOAL_MAX_CHARS);
    expect(SQUAD_PROPOSAL_LIMITS.summaryChars).toBe(SQUAD_SUMMARY_MAX_CHARS);
    expect(SQUAD_GOAL_MAX_CHARS).toBe(2048);
    expect(SQUAD_SUMMARY_MAX_CHARS).toBe(2048);
  });

  it('starts the counter at 1,844, from the one shared ratio', () => {
    expect(SQUAD_LIMIT_COUNTER_RATIO).toBe(0.9);
    expect(SQUAD_LIMIT_COUNTER_FROM).toBe(Math.ceil(SQUAD_GOAL_MAX_CHARS * SQUAD_LIMIT_COUNTER_RATIO));
    expect(SQUAD_LIMIT_COUNTER_FROM).toBe(1844);
  });

  it('formats character counts with thousands separators', () => {
    expect(formatSquadChars(12345)).toBe('12,345');
  });

  it('words the goal message exactly', () => {
    expect(squadGoalTooLongMessage(2049)).toBe(
      'The goal is too long for a Squad (2,049 of 2,048 characters). Move details into an attached plan or source.'
    );
    expect(squadGoalTooLongMessage(2874)).toBe(
      'The goal is too long for a Squad (2,874 of 2,048 characters). Move details into an attached plan or source.'
    );
  });

  it('explains source-name replacement when asked', () => {
    expect(squadGoalTooLongMessage(2063, { afterSourceNames: true })).toBe(
      'The goal is too long for a Squad (2,063 of 2,048 characters). Move details into an attached plan or source. File paths in the goal count after they are replaced by source names.'
    );
  });

  it('words the summary message exactly', () => {
    expect(squadSummaryTooLongMessage(2049)).toBe(
      'The summary is too long for a Squad (2,049 of 2,048 characters). Shorten it or move details into an attached source.'
    );
    expect(squadSummaryTooLongMessage(2874)).toBe(
      'The summary is too long for a Squad (2,874 of 2,048 characters). Shorten it or move details into an attached source.'
    );
  });

  it('words the stored-field message exactly', () => {
    expect(squadStoredFieldTooLong('goal', 2049)).toBe('Squad goal is 2,049 characters; the limit is 2,048');
    expect(squadStoredFieldTooLong('summary', 2874)).toBe('Squad summary is 2,874 characters; the limit is 2,048');
  });

  describe('squadLaunchTextProblem', () => {
    it('accepts exactly the limit and missing fields', () => {
      expect(squadLaunchTextProblem({ goal: 'a'.repeat(2048), summary: 'b'.repeat(2048) })).toBeUndefined();
      expect(squadLaunchTextProblem({})).toBeUndefined();
    });

    it('rejects a goal one over', () => {
      expect(squadLaunchTextProblem({ goal: 'a'.repeat(2049) })).toEqual({
        code: 'GOAL_TOO_LONG',
        message: squadGoalTooLongMessage(2049)
      });
    });

    it('rejects a long summary alone', () => {
      expect(squadLaunchTextProblem({ goal: 'ok', summary: 'b'.repeat(2874) })).toEqual({
        code: 'SUMMARY_TOO_LONG',
        message: squadSummaryTooLongMessage(2874)
      });
    });

    it('reports the goal first when both are long', () => {
      expect(squadLaunchTextProblem({ goal: 'a'.repeat(2049), summary: 'b'.repeat(3000) })?.code).toBe('GOAL_TOO_LONG');
    });

    it('does not trim', () => {
      expect(squadLaunchTextProblem({ goal: ' '.repeat(2049) })?.code).toBe('GOAL_TOO_LONG');
    });
  });
});
