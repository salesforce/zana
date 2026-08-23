import { describe, expect, it } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import { authorizeProjectRelPath, isDeniedProjectRelPath, listProjectDir, listProjectPaths, readProjectFile } from './project-fs-via-host.js';
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

describe('listProjectPaths', () => {
  it('authorizes by project id, confines the host walk, and filters deny names', async () => {
    const commands: unknown[] = [];
    const ctx = {
      toProjects: () => [project({ id: 'zcc', name: 'zcc', path: '/tmp/proj' })],
      hostHub: {
        resolveHostId: () => 'host-1',
        callHostOnlineRpc: async (input: { command: unknown }) => {
          commands.push(input.command);
          return {
            files: [
              { root: '/tmp/proj', relPath: 'README.md', bytes: 12, kind: 'file' },
              { root: '/tmp/proj', relPath: 'src/foo.ts', bytes: 4, kind: 'file' },
              { root: '/tmp/proj', relPath: 'node_modules/pkg/index.js', bytes: 1, kind: 'file' },
              { root: '/tmp/proj', relPath: 'src', bytes: 0, kind: 'dir' }
            ]
          };
        }
      }
    } as unknown as ProductHttpContext;

    await expect(listProjectPaths(ctx, 'zcc', { query: 'foo', limit: 10 })).resolves.toEqual({
      paths: [{
        kind: 'file',
        path: 'src/foo.ts',
        name: 'foo.ts',
        score: 0,
        positions: []
      }],
      truncated: false
    });
    expect(commands).toEqual([{ type: 'host.list_files', roots: ['/tmp/proj'] }]);
  });

  it('does not RPC for an unknown project id', async () => {
    const ctx = {
      toProjects: () => [project({ id: 'zcc', name: 'zcc', path: '/tmp/proj' })],
      hostHub: {
        resolveHostId: () => 'host-1',
        callHostOnlineRpc: async () => {
          throw new Error('should not rpc');
        }
      }
    } as unknown as ProductHttpContext;
    await expect(listProjectPaths(ctx, 'other')).rejects.toMatchObject({
      code: 'unknown-project',
      status: 404
    });
  });

  it('drops denied path segments', () => {
    expect(isDeniedProjectRelPath('node_modules/pkg/index.js')).toBe(true);
    expect(isDeniedProjectRelPath('.git/config')).toBe(true);
    expect(isDeniedProjectRelPath('src/foo.ts')).toBe(false);
  });
});
