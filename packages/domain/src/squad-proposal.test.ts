import { describe, expect, it } from 'vitest';
import { toTeamSummary, type Team } from './product.js';
import {
  SQUAD_PROPOSAL_LIMITS,
  personaCanWriteFiles,
  planningToCoordinationMode
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
});
