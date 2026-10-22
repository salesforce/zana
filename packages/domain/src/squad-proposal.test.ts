import { describe, expect, it } from 'vitest';
import { toTeamSummary, type Team } from './product.js';
import {
  SQUAD_PROPOSAL_LIMITS,
  isLaunchApproval,
  personaCanWriteFiles,
  planningToCoordinationMode,
  resolveLaunchApproval
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
