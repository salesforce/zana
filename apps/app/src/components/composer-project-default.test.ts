import { describe, expect, it } from 'vitest';
import {
  composerProjectLabel,
  composerProjectOptions,
  DEFAULT_COMPOSER_WORKSPACE_LABEL,
  isRemoteWorkspaceProject,
  isScratchWorkspaceProject,
  preferredComposerProjectId,
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

describe('isScratchWorkspaceProject', () => {
  it('matches the quickAgent flag, the scratch folder name, and the legacy folder name', () => {
    expect(isScratchWorkspaceProject(scratch)).toBe(true);
    expect(isScratchWorkspaceProject({ name: SCRATCH_WORKSPACE_NAME })).toBe(true);
    expect(isScratchWorkspaceProject({ name: 'cc-workspace' })).toBe(true);
    expect(isScratchWorkspaceProject(alpha)).toBe(false);
  });
});

describe('isRemoteWorkspaceProject', () => {
  it('treats SSH remotes and host-bound folders as remote', () => {
    expect(isRemoteWorkspaceProject({ remote: { host: 'limited-pony' } })).toBe(true);
    expect(isRemoteWorkspaceProject({ hostId: 'h-remote' })).toBe(true);
    expect(isRemoteWorkspaceProject(alpha)).toBe(false);
    expect(isRemoteWorkspaceProject(undefined)).toBe(false);
  });
});

describe('composerProjectLabel', () => {
  it('shows Default Project for the scratch folder name and keeps other names', () => {
    expect(composerProjectLabel(scratch)).toBe('Default Project');
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

  it('prefers the selected or last-used project over scratch', () => {
    expect(resolveComposerProjectId([scratch, coreRepo, alpha], '', undefined, 'alpha')).toBe('alpha');
  });

  it('ignores a preferred id that is no longer in the list', () => {
    expect(resolveComposerProjectId([scratch, coreRepo], '', undefined, 'gone')).toBe('scratch-1');
  });

  it('keeps the current pick ahead of a preferred id', () => {
    expect(resolveComposerProjectId([scratch, coreRepo, alpha], 'core-repo', undefined, 'alpha')).toBe('core-repo');
  });

  it('keeps a pinned project ahead of last-used and sidebar ids', () => {
    expect(resolveComposerProjectId(
      [scratch, coreRepo, alpha],
      '',
      'core-repo',
      preferredComposerProjectId({ projects: [alpha, scratch, coreRepo], lastProjectId: 'alpha', selectedProjectId: scratch.id })
    )).toBe('core-repo');
  });
});

describe('preferredComposerProjectId', () => {
  it('prefers last-used over a leftover sidebar selection', () => {
    expect(preferredComposerProjectId({ projects: [alpha, scratch, coreRepo],
      lastProjectId: 'alpha',
      selectedProjectId: 'core-repo'
    })).toBe('alpha');
  });

  it('falls back to the sidebar when nothing was last used', () => {
    expect(preferredComposerProjectId({ projects: [alpha, scratch, coreRepo],
      lastProjectId: null,
      selectedProjectId: 'core-repo'
    })).toBe('core-repo');
  });

  it('treats empty strings as missing', () => {
    expect(preferredComposerProjectId({ projects: [alpha, scratch, coreRepo],
      lastProjectId: '',
      selectedProjectId: 'alpha'
    })).toBe('alpha');
    expect(preferredComposerProjectId({ projects: [alpha, scratch, coreRepo],
      lastProjectId: null,
      selectedProjectId: null
    })).toBeUndefined();
  });
});

const remote = { id: 'remote', name: 'Remote', hostId: 'remote-host', quickAgent: true };
const ssh = { id: 'ssh', name: 'SSH', remote: { host: 'devbox' } };

it('keeps remote projects behind local projects and never chooses a remote scratch default', () => {
  const projects = [remote, ssh, alpha, scratch, coreRepo];
  expect(composerProjectOptions(projects).map((row) => row.id)).toEqual([
    scratch.id, alpha.id, coreRepo.id, remote.id, ssh.id
  ]);
  expect(projects[0]).toBe(remote);
  expect(scratchWorkspaceProject(projects)).toBe(scratch);
  expect(scratchWorkspaceProject([remote])).toBeUndefined();
  expect(resolveComposerProjectId(projects, '')).toBe(scratch.id);
});

it('ignores old remote defaults but preserves explicitly selected and pinned remote projects', () => {
  const projects = [remote, ssh, alpha, scratch];
  expect(preferredComposerProjectId({ projects, lastProjectId: remote.id, selectedProjectId: alpha.id })).toBe(alpha.id);
  expect(preferredComposerProjectId({ projects, lastProjectId: ssh.id, selectedProjectId: remote.id })).toBeUndefined();
  expect(preferredComposerProjectId({ projects, lastProjectId: 'deleted', selectedProjectId: alpha.id })).toBe(alpha.id);
  expect(resolveComposerProjectId(projects, remote.id)).toBe(remote.id);
  expect(resolveComposerProjectId(projects, '', ssh.id)).toBe(ssh.id);
});
