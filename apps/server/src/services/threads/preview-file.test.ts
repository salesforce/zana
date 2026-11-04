import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { threadOpenSignalSchema } from '@zana-ai/zcc-server-contract';
import {
  openThreadFilePreview,
  PreviewFileError,
  type PreviewFileDeps
} from './preview-file.js';

function deps(over: Partial<PreviewFileDeps> = {}): PreviewFileDeps & { emitted: unknown[] } {
  const emitted: unknown[] = [];
  return {
    dataDir: mkdtempSync(join(tmpdir(), 'zcc-preview-')),
    getThread: () => ({ id: 'thr-1', projectId: 'proj-1', environmentId: 'env-1' }),
    getEnvironmentPath: () => join(tmpdir(), 'zcc-preview-env'),
    getProjectPath: () => join(tmpdir(), 'zcc-preview-proj'),
    emit: (payload) => {
      emitted.push(payload);
      return 1;
    },
    ...over,
    emitted
  };
}

describe('openThreadFilePreview', () => {
  it('confines a workspace path and emits a thread-open signal', () => {
    const envRoot = mkdtempSync(join(tmpdir(), 'zcc-preview-env-'));
    const d = deps({
      getEnvironmentPath: () => envRoot
    });
    const result = openThreadFilePreview(d, {
      threadId: 'thr-1',
      source: 'workspace',
      path: 'src/a.ts',
      lineNumber: 12
    });
    expect(result).toMatchObject({
      delivered: 1,
      path: 'src/a.ts',
      source: 'workspace',
      threadId: 'thr-1',
      projectId: 'proj-1'
    });
    expect(d.emitted).toHaveLength(1);
    expect(threadOpenSignalSchema.parse(d.emitted[0])).toEqual({
      type: 'thread-open',
      projectId: 'proj-1',
      threadId: 'thr-1',
      split: 'right',
      file: { source: 'workspace', path: 'src/a.ts', lineNumber: 12 }
    });
  });

  it('rejects workspace path escapes', () => {
    const envRoot = mkdtempSync(join(tmpdir(), 'zcc-preview-env-'));
    const d = deps({ getEnvironmentPath: () => envRoot });
    expect(() => openThreadFilePreview(d, {
      threadId: 'thr-1',
      source: 'workspace',
      path: '../secret.txt'
    })).toThrow(PreviewFileError);
    try {
      openThreadFilePreview(d, { threadId: 'thr-1', source: 'workspace', path: '../secret.txt' });
    } catch (error) {
      expect(error).toMatchObject({ status: 403, code: 'path-escape' });
    }
    expect(d.emitted).toHaveLength(0);
  });

  it('rejects an unknown thread without a fallback project', () => {
    const d = deps({ getThread: () => null });
    expect(() => openThreadFilePreview(d, {
      threadId: 'missing',
      source: 'workspace',
      path: 'src/a.ts'
    })).toThrowError(/thread is not registered/);
  });

  it('opens against a PTY panel owner when projectId is supplied', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-preview-proj-'));
    const d = deps({
      getThread: () => null,
      getProjectPath: (id) => (id === 'proj-1' ? projectRoot : null)
    });
    const result = openThreadFilePreview(d, {
      threadId: 'sess-pty',
      projectId: 'proj-1',
      source: 'workspace',
      path: 'README.md'
    });
    expect(result.threadId).toBe('sess-pty');
    expect(result.path).toBe('README.md');
    expect(threadOpenSignalSchema.parse(d.emitted[0])).toMatchObject({
      threadId: 'sess-pty',
      projectId: 'proj-1',
      file: { source: 'workspace', path: 'README.md', lineNumber: null }
    });
  });

  it.each(['conversation', 'cli'])('opens absolute artifacts for a registered %s', (owner) => {
    const d = deps(owner === 'cli' ? { getThread: () => null } : { getEnvironmentPath: () => null });
    const path = join(d.dataDir, 'artifacts', 'data-org-test-20261027', 'B-quote-method-desktop.png');
    const result = openThreadFilePreview(d, {
      threadId: owner === 'cli' ? 'sess-pty' : 'thr-1',
      projectId: 'proj-1', source: 'workspace', path
    });
    expect(result.path).toBe(path);
    expect(threadOpenSignalSchema.parse(d.emitted[0])).toMatchObject({
      file: { source: 'workspace', path, lineNumber: null }
    });
  });

  it('opens attachments only from the conversation project', () => {
    const d = deps();
    const path = join(d.dataDir, 'attachments', 'proj-1', 'shot.png');
    expect(openThreadFilePreview(d, { threadId: 'thr-1', source: 'workspace', path }).path).toBe(path);
    expect(() => openThreadFilePreview(d, {
      threadId: 'thr-1', source: 'workspace', path: join(d.dataDir, 'attachments', 'proj-2', 'shot.png')
    })).toThrow(PreviewFileError);
    expect(d.emitted).toHaveLength(1);
  });

  it('rejects artifact traversal, sibling roots, and using thread storage to open artifacts', () => {
    const d = deps();
    for (const path of [
      join(d.dataDir, 'artifacts-other', 'shot.png'),
      join(d.dataDir, 'artifacts', '..', 'config.json'),
      join(d.dataDir, 'artifacts')
    ]) {
      expect(() => openThreadFilePreview(d, { threadId: 'thr-1', source: 'workspace', path }))
        .toThrow(PreviewFileError);
    }
    expect(() => openThreadFilePreview(d, {
      threadId: 'thr-1', source: 'thread-storage', path: join(d.dataDir, 'artifacts', 'shot.png')
    })).toThrow(PreviewFileError);
    expect(d.emitted).toHaveLength(0);
  });

  it('does not open artifacts for an unregistered thread or project', () => {
    const d = deps({ getThread: () => null, getProjectPath: () => null });
    const path = join(d.dataDir, 'artifacts', 'shot.png');
    expect(() => openThreadFilePreview(d, { threadId: 'missing', source: 'workspace', path }))
      .toThrowError(/thread is not registered/);
    expect(() => openThreadFilePreview(d, {
      threadId: 'missing', projectId: 'missing', source: 'workspace', path
    })).toThrowError(/project is not registered/);
    expect(d.emitted).toHaveLength(0);
  });

  it('confines thread-storage paths against the storage root', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-preview-data-'));
    const d = deps({ dataDir });
    const result = openThreadFilePreview(d, {
      threadId: 'thr-1',
      source: 'thread-storage',
      path: 'notes/plan.md'
    });
    expect(result.path).toBe('notes/plan.md');
    expect(result.source).toBe('thread-storage');
  });

  it('rejects thread-storage escapes', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-preview-data-'));
    const d = deps({ dataDir });
    expect(() => openThreadFilePreview(d, {
      threadId: 'thr-1',
      source: 'thread-storage',
      path: '../outside.md'
    })).toThrow(PreviewFileError);
  });

  describe('trusted preview folders', () => {
    const trustedDir = () => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-preview-trusted-')));
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'sub', 'a.md'), 'x');
      return dir;
    };

    it('opens an absolute path under a trusted folder and passes the target to the provider', () => {
      const dir = trustedDir();
      const seen: unknown[] = [];
      const d = deps({ trustedPreviewFolders: (target) => { seen.push(target); return [dir]; } });
      const path = join(dir, 'sub', 'a.md');
      expect(openThreadFilePreview(d, { threadId: 'thr-1', source: 'workspace', path }).path).toBe(path);
      expect(seen[0]).toMatchObject({ projectId: 'proj-1', thread: { id: 'thr-1' } });
      expect(d.emitted).toHaveLength(1);
    });

    it('opens through a symlinked directory that resolves into the trusted folder', () => {
      const dir = trustedDir();
      const alias = join(realpathSync(mkdtempSync(join(tmpdir(), 'zcc-preview-alias-'))), 'alias');
      symlinkSync(dir, alias);
      const d = deps({ trustedPreviewFolders: () => [dir] });
      const path = join(alias, 'sub', 'a.md');
      // Resolved-form match: the emitted path is the real location inside the trusted folder.
      expect(openThreadFilePreview(d, { threadId: 'thr-1', source: 'workspace', path }).path).toBe(join(dir, 'sub', 'a.md'));
    });

    it('rejects absolute paths outside trusted folders, with no provider, or for sibling-prefix dirs', () => {
      const dir = trustedDir();
      const outside = trustedDir();
      for (const d of [deps({ trustedPreviewFolders: () => [dir] }), deps(), deps({ trustedPreviewFolders: () => [] })]) {
        expect(() => openThreadFilePreview(d, { threadId: 'thr-1', source: 'workspace', path: join(outside, 'sub', 'a.md') }))
          .toThrow(PreviewFileError);
        expect(d.emitted).toHaveLength(0);
      }
      const d = deps({ trustedPreviewFolders: () => [dir] });
      expect(() => openThreadFilePreview(d, { threadId: 'thr-1', source: 'workspace', path: `${dir}-evil/a.md` })).toThrow(PreviewFileError);
    });

    it('passes a null thread for PTY owners', () => {
      const dir = trustedDir();
      const seen: unknown[] = [];
      const d = deps({ getThread: () => null, trustedPreviewFolders: (target) => { seen.push(target); return [dir]; } });
      const path = join(dir, 'sub', 'a.md');
      openThreadFilePreview(d, { threadId: 'sess', projectId: 'proj-1', source: 'workspace', path });
      expect(seen[0]).toEqual({ thread: null, projectId: 'proj-1' });
    });

    it('never consults trusted folders for thread-storage source', () => {
      const dir = trustedDir();
      let called = false;
      const d = deps({ trustedPreviewFolders: () => { called = true; return [dir]; } });
      expect(() => openThreadFilePreview(d, { threadId: 'thr-1', source: 'thread-storage', path: join(dir, 'sub', 'a.md') }))
        .toThrow(PreviewFileError);
      expect(called).toBe(false);
    });
  });
});
