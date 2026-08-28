import { describe, expect, it } from 'vitest';
import { HOST_WORKSPACE_MISMATCH, resolveSpawnChoiceForHost } from './spawn-choice-for-host.js';

const local = { hostId: undefined, quickAgent: false, remote: undefined };
const scratch = { hostId: undefined, quickAgent: true, remote: undefined };
const ssh = { hostId: 'h-enrolled', quickAgent: false, remote: { host: 'devbox' } };

describe('resolveSpawnChoiceForHost', () => {
  it('keeps the choice when the execution host owns the project', () => {
    expect(resolveSpawnChoiceForHost({
      project: local,
      choice: { kind: 'unmanaged' },
      executionHostId: 'h-primary',
      primaryHostId: 'h-primary',
      remoteToolProxy: false
    })).toEqual({ ok: true, choice: { kind: 'unmanaged' }, dropCwd: false });
    expect(resolveSpawnChoiceForHost({
      project: { ...local, hostId: 'h-box' },
      choice: { kind: 'worktree' },
      executionHostId: 'h-box',
      primaryHostId: 'h-primary',
      remoteToolProxy: false
    })).toEqual({ ok: true, choice: { kind: 'worktree' }, dropCwd: false });
  });

  it('turns Default Workspace on another machine into a personal scratch', () => {
    expect(resolveSpawnChoiceForHost({
      project: scratch,
      choice: { kind: 'unmanaged' },
      executionHostId: 'h-pony',
      primaryHostId: 'h-primary',
      remoteToolProxy: false
    })).toEqual({ ok: true, choice: { kind: 'personal' }, dropCwd: true });
    expect(resolveSpawnChoiceForHost({
      project: scratch,
      choice: { kind: 'worktree', branchSlug: 'feat' },
      executionHostId: 'h-pony',
      primaryHostId: 'h-primary',
      remoteToolProxy: false
    })).toEqual({ ok: true, choice: { kind: 'personal' }, dropCwd: true });
  });

  it('refuses a local git folder on another machine', () => {
    expect(resolveSpawnChoiceForHost({
      project: local,
      choice: { kind: 'unmanaged' },
      executionHostId: 'h-pony',
      primaryHostId: 'h-primary',
      remoteToolProxy: false
    })).toEqual({
      ok: false,
      code: HOST_WORKSPACE_MISMATCH,
      message: 'This project’s folder is not on the selected machine. Add a folder on that machine, or pick the host this project lives on.'
    });
  });

  it('leaves SSH remotes to the proxy / remotePath path', () => {
    expect(resolveSpawnChoiceForHost({
      project: ssh,
      choice: { kind: 'unmanaged' },
      executionHostId: 'h-enrolled',
      primaryHostId: 'h-primary',
      remoteToolProxy: false
    })).toEqual({ ok: true, choice: { kind: 'unmanaged' }, dropCwd: false });
    expect(resolveSpawnChoiceForHost({
      project: ssh,
      choice: { kind: 'unmanaged' },
      executionHostId: 'h-primary',
      primaryHostId: 'h-primary',
      remoteToolProxy: true
    })).toEqual({ ok: true, choice: { kind: 'unmanaged' }, dropCwd: false });
  });
});
