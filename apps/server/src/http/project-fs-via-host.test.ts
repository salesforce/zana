import { describe, expect, it } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import { authorizeProjectRelPath, listProjectDir, readProjectFile } from './project-fs-via-host.js';
import type { ProductHttpContext } from './product-context.js';

function project(overrides: Partial<Project> & Pick<Project, 'id' | 'name' | 'path'>): Project {
  return {
    createdAt: 1,
    lastActiveAt: 1,
    ...overrides
  };
}

describe('authorizeProjectRelPath', () => {
  it('maps a nested path onto the longest matching local project', () => {
    const projects = [
      project({ id: 'ws', name: 'ws', path: '/Users/me/zcc-workspace' }),
      project({ id: 'zcc', name: 'zcc', path: '/Users/me/zcc-workspace/zana-command-center' })
    ];
    expect(authorizeProjectRelPath(projects, '/Users/me/zcc-workspace/zana-command-center/apps')).toEqual({
      root: '/Users/me/zcc-workspace/zana-command-center',
      relPath: 'apps'
    });
    expect(authorizeProjectRelPath(projects, '/Users/me/zcc-workspace/zana-command-center')).toEqual({
      root: '/Users/me/zcc-workspace/zana-command-center',
      relPath: ''
    });
  });

  it('rejects a path outside every registered project', () => {
    expect(authorizeProjectRelPath(
      [project({ id: 'zcc', name: 'zcc', path: '/Users/me/proj' })],
      '/etc/passwd'
    )).toBeNull();
    expect(authorizeProjectRelPath(
      [project({ id: 'zcc', name: 'zcc', path: '/Users/me/proj' })],
      '/Users/me/proj/../.ssh'
    )).toBeNull();
  });
});

describe('listProjectDir / readProjectFile', () => {
  it('RPCs host.list_dir after confinement and reads through host.read_file', async () => {
    const commands: unknown[] = [];
    const ctx = {
      toProjects: () => [project({ id: 'zcc', name: 'zcc', path: '/tmp/proj' })],
      hostHub: {
        resolveHostId: () => 'host-1',
        callHostOnlineRpc: async (input: { command: unknown }) => {
          commands.push(input.command);
          const command = input.command as { type: string };
          if (command.type === 'host.list_dir') {
            return { entries: [{ name: 'note.md', kind: 'file', path: '/tmp/proj/note.md' }] };
          }
          return { content: '# hi\n', encoding: 'utf8' };
        }
      }
    } as unknown as ProductHttpContext;

    await expect(listProjectDir(ctx, '/tmp/proj')).resolves.toEqual([
      { name: 'note.md', kind: 'file', path: '/tmp/proj/note.md' }
    ]);
    await expect(readProjectFile(ctx, '/tmp/proj/note.md')).resolves.toMatchObject({
      ok: true,
      content: '# hi\n'
    });
    expect(commands).toEqual([
      { type: 'host.list_dir', root: '/tmp/proj', relPath: '' },
      { type: 'host.read_file', root: '/tmp/proj', relPath: 'note.md' }
    ]);
  });

  it('does not RPC when the path escapes every project', async () => {
    const ctx = {
      toProjects: () => [project({ id: 'zcc', name: 'zcc', path: '/tmp/proj' })],
      hostHub: {
        resolveHostId: () => 'host-1',
        callHostOnlineRpc: async () => {
          throw new Error('should not rpc');
        }
      }
    } as unknown as ProductHttpContext;
    await expect(listProjectDir(ctx, '/etc')).rejects.toMatchObject({ code: 'path-escape', status: 403 });
    await expect(readProjectFile(ctx, '/etc/passwd')).resolves.toMatchObject({ ok: false });
  });
});
