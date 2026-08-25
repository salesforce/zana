import { describe, expect, it } from 'vitest';
import {
  composerProjectLabel,
  composerProjectOptions,
  DEFAULT_COMPOSER_WORKSPACE_LABEL,
  resolveComposerProjectId,
  scratchWorkspaceProject,
  SCRATCH_WORKSPACE_NAME
} from './composer-project-default.js';

const alpha = { id: 'alpha', name: 'alpha-repo' };
const scratch = { id: 'scratch-1', name: SCRATCH_WORKSPACE_NAME, quickAgent: true };
const zana = { id: 'zana', name: 'zana-command-center' };

describe('scratchWorkspaceProject', () => {
  it('prefers the quickAgent scratch project over a name match', () => {
    expect(scratchWorkspaceProject([alpha, scratch, { id: 'other', name: 'zcc-workspace' }])).toEqual(scratch);
  });

  it('falls back to a project named zcc-workspace when the flag is missing', () => {
    expect(scratchWorkspaceProject([zana, { id: 'ws', name: SCRATCH_WORKSPACE_NAME }])?.id).toBe('ws');
  });
});

describe('composerProjectLabel', () => {
  it('shows Default (zcc-workspace) for the scratch workspace', () => {
    expect(composerProjectLabel(scratch)).toBe('Default (zcc-workspace)');
    expect(composerProjectLabel({ id: 'ws', name: SCRATCH_WORKSPACE_NAME })).toBe(DEFAULT_COMPOSER_WORKSPACE_LABEL);
    expect(composerProjectLabel(zana)).toBe('zana-command-center');
  });
});

describe('composerProjectOptions', () => {
  it('keeps the scratch workspace first without reordering the rest', () => {
    expect(composerProjectOptions([alpha, scratch, zana]).map((row) => row.id)).toEqual([
      'scratch-1',
      'alpha',
      'zana'
    ]);
  });
});

describe('resolveComposerProjectId', () => {
  it('uses a pinned project and skips the scratch default', () => {
    expect(resolveComposerProjectId([scratch, zana], '', 'zana')).toBe('zana');
  });

  it('defaults to zcc-workspace when the user has not selected a project', () => {
    expect(resolveComposerProjectId([zana, scratch, alpha], '')).toBe('scratch-1');
  });

  it('keeps a user-selected project instead of snapping back to scratch', () => {
    expect(resolveComposerProjectId([scratch, zana], 'zana')).toBe('zana');
  });

  it('returns empty when scratch is not in the list yet', () => {
    expect(resolveComposerProjectId([zana, alpha], '')).toBe('');
  });
});
