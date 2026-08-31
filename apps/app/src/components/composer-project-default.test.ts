import { describe, expect, it } from 'vitest';
import {
  composerProjectLabel,
  composerProjectOptions,
  DEFAULT_COMPOSER_WORKSPACE_LABEL,
  resolveComposerProjectId,
  scratchWorkspaceProject,
  SCRATCH_WORKSPACE_NAME
} from './composer-project-default.js';

const alpha = { id: 'alpha', name: 'alpha-repo', quickAgent: false };
const scratch = { id: 'scratch-1', name: SCRATCH_WORKSPACE_NAME, quickAgent: true };
const coreRepo = { id: 'core-repo', name: 'zana-command-center', quickAgent: false };

describe('scratchWorkspaceProject', () => {
  it('prefers the quickAgent scratch project over a name match', () => {
    expect(scratchWorkspaceProject([alpha, scratch, { id: 'other', name: 'zcc-workspace' }])).toEqual(scratch);
  });

  it('falls back to a project named zcc-workspace when the flag is missing', () => {
    expect(scratchWorkspaceProject([coreRepo, { id: 'ws', name: SCRATCH_WORKSPACE_NAME }])?.id).toBe('ws');
  });
});

describe('composerProjectLabel', () => {
  it('shows Default Workspace for the scratch folder name and keeps other names', () => {
    expect(composerProjectLabel(scratch)).toBe('Default Workspace');
    expect(composerProjectLabel({ id: 'ws', name: SCRATCH_WORKSPACE_NAME })).toBe(DEFAULT_COMPOSER_WORKSPACE_LABEL);
    expect(composerProjectLabel(coreRepo)).toBe('zana-command-center');
  });

  it('keeps a custom scratch-workspace name', () => {
    expect(composerProjectLabel({ id: 'scratch-1', name: 'My Scratch', quickAgent: true })).toBe('My Scratch');
  });

  it('relabels the legacy cc-workspace folder name', () => {
    expect(composerProjectLabel({ id: 'ws', name: 'cc-workspace' })).toBe(DEFAULT_COMPOSER_WORKSPACE_LABEL);
  });
});

describe('composerProjectOptions', () => {
  it('keeps the scratch workspace first without reordering the rest', () => {
    expect(composerProjectOptions([alpha, scratch, coreRepo]).map((row) => row.id)).toEqual([
      'scratch-1',
      'alpha',
      'core-repo'
    ]);
  });
});

describe('resolveComposerProjectId', () => {
  it('uses a pinned project and skips the scratch default', () => {
    expect(resolveComposerProjectId([scratch, coreRepo], '', 'core-repo')).toBe('core-repo');
  });

  it('defaults to zcc-workspace when the user has not selected a project', () => {
    expect(resolveComposerProjectId([coreRepo, scratch, alpha], '')).toBe('scratch-1');
  });

  it('keeps a user-selected project instead of snapping back to scratch', () => {
    expect(resolveComposerProjectId([scratch, coreRepo], 'core-repo')).toBe('core-repo');
  });

  it('returns empty when scratch is not in the list yet', () => {
    expect(resolveComposerProjectId([coreRepo, alpha], '')).toBe('');
  });
});
