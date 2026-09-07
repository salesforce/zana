import { describe, expect, it } from 'vitest';
import { inspectRemoteStartPath } from './remote-start-path-inspect.js';

describe('inspectRemoteStartPath', () => {
  it('names the matched machine and reports the path source', () => {
    const inspection = inspectRemoteStartPath(
      {
        path: '/tmp/placeholder',
        hostId: 'h-pony',
        remote: { host: 'limited-pony' }
      },
      [{
        id: 'h-pony',
        name: 'Limited Pony',
        isPrimary: false,
        sshHost: 'limited-pony',
        defaultWorkspacePath: '/opt/workspace/core'
      }],
      '/opt/workspace/core-public'
    );
    expect(inspection).toEqual({
      machineName: 'Limited Pony',
      source: 'machine',
      sourceLabel: 'Machine',
      path: '/opt/workspace/core'
    });
  });

  it('returns null for local projects', () => {
    expect(inspectRemoteStartPath({ path: '/tmp/local' }, [], '/opt')).toBeNull();
  });
});
