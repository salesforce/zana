import { afterEach, describe, expect, it } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import {
  refreshRemoteStartPathHosts,
  remoteStartPathHosts,
  setRemoteStartPathHosts,
  stampedProjectRemote
} from './remote-workspace.js';

const project: Project = {
  id: 'p-ssh',
  name: 'Remote',
  path: '/tmp/placeholder',
  createdAt: 1,
  lastActiveAt: 1,
  hostId: 'h-pony',
  remote: { host: 'limited-pony', user: 'sfwork' }
};

afterEach(() => {
  setRemoteStartPathHosts([]);
});

describe('stampedProjectRemote', () => {
  it('stamps the matching machine default ahead of the global fallback', () => {
    setRemoteStartPathHosts([{
      id: 'h-pony',
      name: 'Limited Pony',
      isPrimary: false,
      sshHost: 'limited-pony',
      defaultWorkspacePath: '/opt/workspace/core',
      homeDir: '/home/sfwork'
    }]);
    expect(stampedProjectRemote(project, '/opt/workspace/core-public')).toEqual({
      host: 'limited-pony',
      user: 'sfwork',
      remotePath: '/opt/workspace/core'
    });
  });

  it('falls through to global then drops the path for unpaired HOME', () => {
    expect(stampedProjectRemote(project, '/opt/workspace/core-public')?.remotePath).toBe(
      '/opt/workspace/core-public'
    );
    expect(stampedProjectRemote(project)).toEqual({
      host: 'limited-pony',
      user: 'sfwork'
    });
  });
});

describe('refreshRemoteStartPathHosts', () => {
  it('replaces the snapshot from a successful hosts list', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify([
      {
        id: 'h-kit',
        name: 'Kit Kat',
        type: 'persistent',
        status: 'connected',
        maxPermissionMode: 'full',
        lastSeenAt: 1,
        lastRejectedProtocolVersion: null,
        isPrimary: false,
        canRepairViaSsh: true,
        sshHost: 'kit-kat',
        defaultWorkspacePath: '/home/sfwork/core',
        homeDir: '/home/sfwork',
        createdAt: 1,
        updatedAt: 1
      }
    ]), { status: 200 })) as typeof fetch;
    try {
      await refreshRemoteStartPathHosts('http://127.0.0.1:8780/');
      expect(remoteStartPathHosts()).toEqual([
        {
          id: 'h-kit',
          name: 'Kit Kat',
          isPrimary: false,
          sshHost: 'kit-kat',
          defaultWorkspacePath: '/home/sfwork/core',
          homeDir: '/home/sfwork'
        }
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
