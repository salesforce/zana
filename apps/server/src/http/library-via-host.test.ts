import { describe, expect, it } from 'vitest';
import type { HostListFilesResult, HostReadFileResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { Project } from '@zana-ai/zcc-domain/product';
import { listLibraryDocs, readLibraryDoc, writeLibraryDoc } from './library-via-host.js';
import type { ProductHttpContext } from './product-context.js';

function project(overrides: Partial<Project> & Pick<Project, 'id' | 'name' | 'path'>): Project {
  return {
    createdAt: 1,
    lastActiveAt: 1,
    ...overrides
  };
}

function ctx(options: {
  dataDir: string;
  projects?: Project[];
  list?: HostListFilesResult;
  read?: HostReadFileResult;
}): ProductHttpContext {
  return {
    dataDir: options.dataDir,
    toProjects: () => options.projects ?? [],
    hostHub: {
      resolveHostId: (hostId?: string) => hostId ?? 'host-1',
      callHostOnlineRpc: async () => options.list ?? options.read ?? { files: [] }
    }
  } as unknown as ProductHttpContext;
}

describe('listLibraryDocs', () => {
  it('stamps absPath from the authorized root plus the host-relative path', async () => {
    const dataDir = '/tmp/zcc-data';
    const projectRoot = '/tmp/zana-builder';
    const docs = await listLibraryDocs(ctx({
      dataDir,
      projects: [project({ id: 'p1', name: 'zana-builder', path: projectRoot })],
      list: {
        files: [
          {
            root: `${dataDir}/library`,
            relPath: 'ideas/note.md',
            bytes: 12,
            kind: 'file'
          },
          {
            root: `${projectRoot}/.zcc/library`,
            relPath: 'findings/zana-builder-full-app-review-2026-08-17.md',
            bytes: 99,
            kind: 'file'
          }
        ]
      }
    }));

    expect(docs).toEqual([
      expect.objectContaining({
        relPath: 'ideas/note.md',
        scope: 'global',
        absPath: `${dataDir}/library/ideas/note.md`
      }),
      expect.objectContaining({
        relPath: 'findings/zana-builder-full-app-review-2026-08-17.md',
        scope: 'project',
        projectId: 'p1',
        projectName: 'zana-builder',
        absPath: `${projectRoot}/.zcc/library/findings/zana-builder-full-app-review-2026-08-17.md`
      })
    ]);
  });

  it('skips directories and index.json', async () => {
    const dataDir = '/tmp/zcc-data';
    const docs = await listLibraryDocs(ctx({
      dataDir,
      list: {
        files: [
          { root: `${dataDir}/library`, relPath: 'findings', bytes: 0, kind: 'dir' },
          { root: `${dataDir}/library`, relPath: 'index.json', bytes: 2, kind: 'file' },
          { root: `${dataDir}/library`, relPath: 'notes/index.json', bytes: 2, kind: 'file' },
          { root: `${dataDir}/library`, relPath: 'notes/keep.md', bytes: 4, kind: 'file' }
        ]
      }
    }));
    expect(docs.map((doc) => doc.relPath)).toEqual(['notes/keep.md']);
  });
});

describe('writeLibraryDoc', () => {
  it('rejects a path that escapes the library root', async () => {
    const result = await writeLibraryDoc(
      ctx({ dataDir: '/tmp/zcc-data' }),
      'global',
      '../secret',
      'nope'
    );
    expect(result).toEqual({ ok: false, message: 'path escapes library root' });
  });

  it('writes utf8 content under the authorized library root', async () => {
    const commands: unknown[] = [];
    const context = {
      dataDir: '/tmp/zcc-data',
      toProjects: () => [],
      hostHub: {
        resolveHostId: (hostId?: string) => hostId ?? 'host-1',
        callHostOnlineRpc: async (input: { command: unknown }) => {
          commands.push(input.command);
          return { outcome: 'written', sha256: 'abc', sizeBytes: 4 };
        }
      }
    } as unknown as ProductHttpContext;
    const result = await writeLibraryDoc(context, 'global', 'ideas/note.md', '# Hi\n');
    expect(result).toEqual({ ok: true });
    expect(commands).toEqual([{
      type: 'host.write_file',
      path: '/tmp/zcc-data/library/ideas/note.md',
      rootPath: '/tmp/zcc-data/library',
      content: '# Hi\n',
      contentEncoding: 'utf8',
      createParents: true
    }]);
  });
});
