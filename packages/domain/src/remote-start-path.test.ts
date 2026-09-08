import { describe, expect, it } from 'vitest';
import {
  matchHostForRemoteProject,
  remoteStartPathSourceLabel,
  resolveRemoteStartPath,
  stampRemoteStartPath,
  type RemoteStartPathHost
} from './remote-start-path.js';

const pony: RemoteStartPathHost = {
  id: 'h-pony',
  name: 'Limited Pony',
  isPrimary: false,
  sshHost: 'limited-pony',
  defaultWorkspacePath: '/opt/workspace/core',
  homeDir: '/home/sfwork'
};

const kit: RemoteStartPathHost = {
  id: 'h-kit',
  name: 'Kit Kat',
  isPrimary: false,
  sshHost: 'kit-kat',
  defaultWorkspacePath: '/home/sfwork/core',
  homeDir: '/home/sfwork'
};

const primary: RemoteStartPathHost = {
  id: 'h-mac',
  name: 'This Mac',
  isPrimary: true,
  sshHost: null,
  defaultWorkspacePath: '/should-not-use',
  homeDir: '/Users/me'
};

const ssh = {
  path: '/tmp/placeholder',
  hostId: pony.id,
  remote: { host: 'limited-pony' }
};

describe('matchHostForRemoteProject', () => {
  it('prefers bound hostId over sshHost and ignores the display name', () => {
    expect(matchHostForRemoteProject(ssh, [kit, pony, primary])?.id).toBe('h-pony');
    expect(matchHostForRemoteProject({
      ...ssh,
      hostId: undefined,
      remote: { host: 'kit-kat' }
    }, [pony, kit])?.id).toBe('h-kit');
    expect(matchHostForRemoteProject({
      ...ssh,
      hostId: undefined,
      remote: { host: 'Limited Pony' }
    }, [pony])).toBeNull();
  });

  it('does not treat this Mac as an SSH workspace default', () => {
    expect(matchHostForRemoteProject({
      ...ssh,
      hostId: primary.id
    }, [primary, pony])).toEqual(pony);
    expect(matchHostForRemoteProject({
      path: '/tmp/local',
      remote: { host: 'limited-pony' }
    }, [primary])).toBeNull();
  });
});

describe('resolveRemoteStartPath', () => {
  it('uses local project.path on this machine and for remote tools', () => {
    expect(resolveRemoteStartPath({
      project: { path: '/tmp/local' },
      remoteToolProxy: false
    })).toMatchObject({ path: '/tmp/local', source: 'project', host: null });
    expect(resolveRemoteStartPath({
      project: { ...ssh, remote: { host: 'limited-pony', remotePath: '/src' } },
      remoteToolProxy: true,
      hosts: [pony],
      remoteDefaultPath: '/opt/workspace/core-public'
    })).toMatchObject({ path: '/tmp/placeholder', source: 'project' });
  });

  it('walks project → machine → global → home', () => {
    expect(resolveRemoteStartPath({
      project: { ...ssh, remote: { host: 'limited-pony', remotePath: '/src' } },
      remoteToolProxy: false,
      hosts: [pony],
      remoteDefaultPath: '/opt/workspace/core-public'
    })).toMatchObject({ path: '/src', source: 'project', host: pony });

    expect(resolveRemoteStartPath({
      project: ssh,
      remoteToolProxy: false,
      hosts: [pony],
      remoteDefaultPath: '/opt/workspace/core-public'
    })).toMatchObject({ path: '/opt/workspace/core', source: 'machine', host: pony });

    expect(resolveRemoteStartPath({
      project: { ...ssh, hostId: undefined, remote: { host: 'unpaired' } },
      remoteToolProxy: false,
      hosts: [pony],
      remoteDefaultPath: '/opt/workspace/core-public'
    })).toMatchObject({ path: '/opt/workspace/core-public', source: 'global', host: null });

    expect(resolveRemoteStartPath({
      project: ssh,
      remoteToolProxy: false,
      hosts: [{ ...pony, defaultWorkspacePath: '  ' }],
      remoteDefaultPath: '  '
    })).toMatchObject({ path: '/home/sfwork', source: 'home', host: { id: 'h-pony' } });

    expect(resolveRemoteStartPath({
      project: { path: '/tmp/placeholder', remote: { host: 'unpaired' } },
      remoteToolProxy: false,
      hosts: [pony]
    })).toMatchObject({ path: null, source: 'home', host: null });
  });
});

describe('stampRemoteStartPath', () => {
  it('writes the resolved path and drops an empty home fallback', () => {
    expect(stampRemoteStartPath({ host: 'devbox', remotePath: '/old' }, '/opt/core')).toEqual({
      host: 'devbox',
      remotePath: '/opt/core'
    });
    expect(stampRemoteStartPath({ host: 'devbox', remotePath: '/old', user: 'me' }, null)).toEqual({
      host: 'devbox',
      user: 'me'
    });
  });
});

describe('remoteStartPathSourceLabel', () => {
  it('uses the inspection labels', () => {
    expect(remoteStartPathSourceLabel('project')).toBe('Project');
    expect(remoteStartPathSourceLabel('machine')).toBe('Machine');
    expect(remoteStartPathSourceLabel('global')).toBe('Global');
    expect(remoteStartPathSourceLabel('home')).toBe('Home');
  });
});
