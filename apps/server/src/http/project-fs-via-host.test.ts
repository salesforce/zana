import { afterAll, describe, expect, it } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import { authorizeProjectRelPath, parseProjectFileScope, isDeniedProjectRelPath, listProjectDir, listProjectPaths, readProjectFile } from './project-fs-via-host.js';
import { HostUnavailableError, AmbiguousHostError } from './host-hub.js';
import type { ProductHttpContext } from './product-context.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, upsertHost, createEnvironment } from '@zana-ai/zcc-db';
import { projectFileRoot, readProjectImage } from './project-fs-via-host.js';

const primaryDir = mkdtempSync(join(tmpdir(), 'project-primary-'));
const primaryDb = openDatabase(join(primaryDir, 'test.sqlite'));
upsertHost(primaryDb, { id: 'host-1', name: 'Primary', hostKeyHash: 'a'.repeat(64) });
afterAll(() => { primaryDb.close(); rmSync(primaryDir, { recursive: true, force: true }); });

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
    expect(authorizeProjectRelPath(
      [project({ id: 'zcc', name: 'zcc', path: '/Users/me/proj' })],
      'Q:\\Users\\me\\proj'
    )).toBeNull();
  });

  it('matches a remote-host checkout without resolving the path on this machine', () => {
    expect(authorizeProjectRelPath(
      [project({ id: 'remote', name: 'box', path: '/home/dev/app', hostId: 'host-2' })],
      '/home/dev/app/src'
    )).toEqual({
      root: '/home/dev/app',
      relPath: 'src',
      hostId: 'host-2'
    });
  });

  it('matches backslash paths under a Windows host checkout', () => {
    const projects = [project({ id: 'win', name: 'win', path: 'C:\\code\\New MAR', hostId: 'host-1' })];
    expect(authorizeProjectRelPath(projects, 'C:\\code\\New MAR\\force-app\\README.md')).toEqual({
      root: 'C:\\code\\New MAR',
      relPath: 'force-app/README.md',
      hostId: 'host-1'
    });
    expect(authorizeProjectRelPath(projects, 'c:/code/new mar/README.md')).toEqual({
      root: 'C:\\code\\New MAR',
      relPath: 'README.md',
      hostId: 'host-1'
    });
    expect(authorizeProjectRelPath(projects, 'C:\\code\\New MAR')?.relPath).toBe('');
    expect(authorizeProjectRelPath(projects, 'C:\\code\\New MARX\\a.md')).toBeNull();
  });

  it('keeps backslashes literal under a POSIX host checkout', () => {
    expect(authorizeProjectRelPath(
      [project({ id: 'remote', name: 'box', path: '/home/dev/app', hostId: 'host-2' })],
      '/home/dev/app\\..\\secret'
    )).toBeNull();
  });
});

describe('listProjectDir / readProjectFile', () => {
  it('RPCs host.list_dir after confinement and reads through host.read_file', async () => {
    const commands: unknown[] = [];
    const ctx = {
      db: primaryDb,
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

  it('marks host base64 image reads as binary without exposing bytes as text', async () => {
    const ctx = {
      db: primaryDb,
      toProjects: () => [project({ id: 'zcc', name: 'zcc', path: '/tmp/proj' })],
      hostHub: {
        resolveHostId: () => 'host-1',
        callHostOnlineRpc: async () => ({ content: 'iVBORw0KGgo=', encoding: 'base64' })
      }
    } as unknown as ProductHttpContext;
    await expect(readProjectFile(ctx, '/tmp/proj/shot.png')).resolves.toEqual({
      ok: true,
      binary: true,
      bytes: Buffer.byteLength('iVBORw0KGgo=', 'base64'),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
  });

  it('does not RPC when the path escapes every project', async () => {
    const ctx = {
      db: primaryDb,
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
      db: primaryDb,
      toProjects: () => [project({ id: 'zcc', name: 'zcc', path: '/tmp/proj' })],
      hostHub: {
        resolveHostId: () => 'host-1',
        callHostOnlineRpc: async (input: { command: unknown }) => {
          commands.push(input.command);
          return {
            paths: [
              {
                kind: 'file',
                path: 'src/foo.ts',
                name: 'foo.ts',
                score: 12,
                positions: [4, 5, 6]
              },
              {
                kind: 'file',
                path: 'node_modules/pkg/index.js',
                name: 'index.js',
                score: 0,
                positions: []
              }
            ],
            truncated: false
          };
        }
      }
    } as unknown as ProductHttpContext;

    await expect(listProjectPaths(ctx, 'zcc', { query: 'foo', limit: 10 })).resolves.toEqual({
      paths: [{
        kind: 'file',
        path: 'src/foo.ts',
        name: 'foo.ts',
        score: 12,
        positions: [4, 5, 6]
      }],
      truncated: false
    });
    expect(commands).toEqual([{
      type: 'host.list_paths',
      path: '/tmp/proj',
      query: 'foo',
      limit: 10,
      includeFiles: true,
      includeDirectories: true
    }]);
  });

  it('does not RPC for an unknown project id', async () => {
    const ctx = {
      db: primaryDb,
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

  it('returns empty when both kinds are excluded and rejects a pathless project', async () => {
    const ctx = {
      db: primaryDb,
      toProjects: () => [
        project({ id: 'zcc', name: 'zcc', path: '/tmp/proj' }),
        project({ id: 'empty', name: 'empty', path: '' })
      ],
      hostHub: {
        resolveHostId: () => 'host-1',
        callHostOnlineRpc: async () => {
          throw new Error('should not rpc');
        }
      }
    } as unknown as ProductHttpContext;
    await expect(listProjectPaths(ctx, 'zcc', {
      includeFiles: false,
      includeDirectories: false
    })).resolves.toEqual({ paths: [], truncated: false });
    await expect(listProjectPaths(ctx, 'empty')).rejects.toMatchObject({
      code: 'path-unavailable',
      status: 400
    });
  });

  it('drops denied path segments', () => {
    expect(isDeniedProjectRelPath('node_modules/pkg/index.js')).toBe(true);
    expect(isDeniedProjectRelPath('.git/config')).toBe(true);
    expect(isDeniedProjectRelPath('src/foo.ts')).toBe(false);
  });
});

describe('explicit project source routing', () => {
  const scope = { projectId: 'p', hostId: 'remote' };
  const projects = [project({ id: 'p', name: 'Shared', path: '/primary/repo', hostId: 'primary', sources: [{ id: 's', hostId: 'remote', path: '/remote/repo', createdAt: 1 }] })];
  it('reads and searches the selected source and rejects any root fallback', async () => {
    const calls: Array<{ hostId: string; command: any }> = [];
    const ctx = { db: primaryDb, toProjects: () => projects, hostHub: {
      resolveHostId: (id: string) => id,
      callHostOnlineRpc: async (call: any) => {
        calls.push(call);
        if (call.command.type === 'host.list_dir') return { entries: [] };
        if (call.command.type === 'host.list_paths') return { paths: [], truncated: false };
        return { content: 'remote', encoding: 'utf8' };
      }
    } } as unknown as ProductHttpContext;
    expect(await readProjectFile(ctx, '/remote/repo/a', scope)).toMatchObject({ content: 'remote' });
    await listProjectDir(ctx, '/remote/repo', scope);
    await listProjectPaths(ctx, 'p', { hostId: 'remote', limit: 1000 });
    expect(calls.map(call => call.hostId)).toEqual(['remote', 'remote', 'remote']);
    expect(calls[0]!.command).toEqual({ type: 'host.read_file', root: '/remote/repo', relPath: 'a' });
    expect(calls[2]!.command).toMatchObject({ path: '/remote/repo', limit: 200 });
    expect(await readProjectFile(ctx, '/primary/repo/a', scope)).toMatchObject({ ok: false });
    expect(await readProjectFile(ctx, '/remote/repo/../secret', scope)).toMatchObject({ ok: false });
    await expect(listProjectDir(ctx, '/remote/repo', { ...scope, hostId: 'other' })).rejects.toMatchObject({ status: 409 });
    await expect(listProjectDir(ctx, '/remote/repo', { ...scope, projectId: 'missing' })).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(3);
  });
  it('refuses ambiguous legacy paths on different hosts', () => {
    const samePaths = [project({ id: 'a', name: 'A', hostId: 'a', path: '/repo' }), project({ id: 'b', name: 'B', hostId: 'b', path: '/repo/nested' })];
    expect(() => authorizeProjectRelPath(samePaths, '/repo/nested/file')).toThrow('Choose the project and machine');
  });
});

it('validates the complete source scope and rejects forged roots', () => {
  expect(parseProjectFileScope(undefined)).toBeUndefined();
  expect(parseProjectFileScope({ projectId: 'p', hostId: 'h', environmentId: 'e' })).toEqual({ projectId: 'p', hostId: 'h', environmentId: 'e' });
  for (const value of [null, [], false, {}, { projectId: '', hostId: 'h' }, { projectId: 'p'.repeat(257), hostId: 'h' }, { projectId: 'p', hostId: '' }, { projectId: 'p', hostId: 'h'.repeat(129) }, { projectId: 'p', hostId: 'h', environmentId: 3 }, { projectId: 'p', hostId: 'h', environmentId: '' }, { projectId: 'p', hostId: 'h', root: '/etc' }]) {
    expect(() => parseProjectFileScope(value)).toThrow('Invalid project file scope');
  }
});

it('pins environment paths to their project and host, including historical sources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'source-environment-'));
  const db = openDatabase(join(dir, 'test.sqlite'));
  try {
    const primary = upsertHost(db, { name: 'Primary', hostKeyHash: 'a'.repeat(64) });
    const remote = upsertHost(db, { name: 'Remote', hostKeyHash: 'b'.repeat(64), isPrimary: false });
    const ctx = { db, toProjects: () => [project({ id: 'p', name: 'Shared', path: '/primary/repo' })] } as ProductHttpContext;
    expect(projectFileRoot(ctx, { projectId: 'p', hostId: primary.id })).toEqual({ root: '/primary/repo', hostId: primary.id });
    const scope = { projectId: 'p', hostId: remote.id };
    expect(() => projectFileRoot(ctx, scope)).toThrow('no checkout');
    const ready = createEnvironment(db, { projectId: 'p', hostId: remote.id, path: '/historical/worktree', status: 'ready' });
    expect(projectFileRoot(ctx, { ...scope, environmentId: ready.id })).toEqual({ root: '/historical/worktree', hostId: remote.id });
    const invalid = [
      { ...scope, environmentId: 'missing' },
      { projectId: 'p', hostId: primary.id, environmentId: ready.id },
      ...[
        { projectId: 'other', path: '/other', status: 'ready' as const },
        { projectId: 'p', path: null, status: 'ready' as const }
      ].map(fields => ({ ...scope, environmentId: createEnvironment(db, { hostId: remote.id, ...fields }).id }))
    ];
    for (const input of invalid) expect(() => projectFileRoot(ctx, input)).toThrow('does not belong');
    for (const [status, message] of [
      ['provisioning', 'Environment preparation is still in progress'],
      ['failed', 'Environment preparation failed'],
      ['retiring', 'Environment is unavailable (retiring)'],
      ['destroying', 'Environment is unavailable (destroying)'],
      ['destroyed', 'Environment is unavailable (destroyed)']
    ] as const) {
      const environment = createEnvironment(db, { projectId: 'p', hostId: remote.id, path: '/state/' + status, status });
      expect(() => projectFileRoot(ctx, { ...scope, environmentId: environment.id })).toThrow(message);
      // An untrusted scope must still fail the ownership check first.
      expect(() => projectFileRoot(ctx, { projectId: 'p', hostId: primary.id, environmentId: environment.id })).toThrow('does not belong');
    }
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
it('surfaces host loss and ambiguous ownership without falling back to local files', async () => {
  let failure: unknown;
  const ctx = { db: primaryDb, toProjects: () => [project({ id: 'p', name: 'P', path: '/repo', hostId: 'h' })], hostHub: { resolveHostId: () => 'h', callHostOnlineRpc: async () => { throw failure; } } } as unknown as ProductHttpContext;
  for (const error of [new HostUnavailableError(), new AmbiguousHostError(), new Error('Unexpected read failure')]) {
    failure = error;
    await expect(listProjectDir(ctx, '/repo')).rejects.toThrow(error.message);
    await expect(readProjectFile(ctx, '/repo/a')).rejects.toThrow(error.message);
    await expect(listProjectPaths(ctx, 'p')).rejects.toThrow(error.message);
  }
  failure = { code: 'path_not_found' };
  expect(await listProjectDir(ctx, '/repo')).toEqual([]);
  expect(await readProjectFile(ctx, '/repo/a')).toEqual({ ok: false, message: 'file not found' });
  failure = { code: 'too_large' };
  expect(await readProjectFile(ctx, '/repo/a')).toEqual({ ok: false, message: 'file exceeds the read cap' });
  await expect(listProjectDir(ctx, '/repo/../secret')).rejects.toMatchObject({ code: 'path-escape' });
  expect(await readProjectFile(ctx, '/repo')).toMatchObject({ ok: false });
  expect(authorizeProjectRelPath(ctx.toProjects(), 'relative')).toBeNull();
  expect(authorizeProjectRelPath([project({ id: 'r', name: 'SSH', path: '/repo', remote: { host: 'remote' } as any })], '/repo/a')).toBeNull();
});

it('previews images on the selected host with bounded data URLs and no path fallback', async () => {
  let content = 'iVBORw0KGgo=', encoding = 'base64'; const calls: any[] = [];
  const ctx = { db: primaryDb, toProjects: () => [project({ id: 'p', name: 'P', path: '/primary', hostId: 'primary', sources: [{ id: 's', hostId: 'h', path: '/repo', createdAt: 1 }] })], hostHub: { resolveHostId: (id: string) => id, callHostOnlineRpc: async (call: any) => { calls.push(call); return { content, encoding }; } } } as unknown as ProductHttpContext;
  const scope = { projectId: 'p', hostId: 'h' };
  expect(await readProjectImage(ctx, '/repo/shot.PNG', scope)).toEqual({ ok: true, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
  expect(calls[0]).toEqual({ hostId: 'h', command: { type: 'host.read_file', root: '/repo', relPath: 'shot.PNG' } });
  content = '<svg/>'; encoding = 'utf8';
  expect((await readProjectImage(ctx, '/repo/shot.svg', scope)).dataUrl).toBe('data:image/svg+xml;base64,' + Buffer.from(content).toString('base64'));
  for (const path of ['/primary/shot.png', '/repo/../shot.png', '/repo/file.txt']) await expect(readProjectImage(ctx, path, scope)).rejects.toMatchObject({ status: 403 });
  expect(calls).toHaveLength(2);
  content = 'x'.repeat(10 * 1024 * 1024 + 1);
  await expect(readProjectImage(ctx, '/repo/huge.svg', scope)).rejects.toMatchObject({ status: 413 });
});
