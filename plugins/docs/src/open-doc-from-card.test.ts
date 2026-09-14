import { describe, expect, it } from 'vitest';
import { libraryPanelSubPath, parseLibraryPanelSubPath } from './library-panel-path.js';
import { openDocFromCard } from './open-doc-from-card.js';

const libraryDoc = {
  path: 'findings/auth.md',
  title: 'Auth findings',
  source: 'library' as const,
  scope: 'project' as const,
  vault: null
};

describe('library panel path', () => {
  it('encodes project and global subpaths', () => {
    expect(libraryPanelSubPath({
      scope: 'project',
      projectId: 'p1',
      relPath: 'findings/auth.md'
    })).toBe('project/p1/findings/auth.md');
    expect(libraryPanelSubPath({ scope: 'global', relPath: 'ideas/note.md' })).toBe('global/ideas/note.md');
  });

  it('parses the same shape back', () => {
    expect(parseLibraryPanelSubPath('project/p1/findings/auth.md')).toEqual({
      scope: 'project',
      projectId: 'p1',
      relPath: 'findings/auth.md'
    });
    expect(parseLibraryPanelSubPath('global/ideas/note.md')).toEqual({
      scope: 'global',
      relPath: 'ideas/note.md'
    });
    expect(parseLibraryPanelSubPath('')).toBeNull();
  });
});

describe('openDocFromCard', () => {
  it('opens a workspace file in the host preview', () => {
    const opened: string[] = [];
    expect(openDocFromCard({
      document: { ...libraryDoc, source: 'workspace', path: 'docs/guide.md' },
      projectId: 'p1',
      openWorkspaceFile: (path: string) => {
        opened.push(path);
        return true;
      },
      openThreadPanel: () => {
        throw new Error('should not open the document panel');
      },
      toPluginPanel: () => {
        throw new Error('should not navigate');
      }
    })).toBe(true);
    expect(opened).toEqual(['docs/guide.md']);
  });

  it('opens the document thread panel with library params', () => {
    const panels: unknown[] = [];
    expect(openDocFromCard({
      document: libraryDoc,
      projectId: 'p1',
      openWorkspaceFile: null,
      openThreadPanel: (options) => {
        panels.push(options);
        return true;
      },
      toPluginPanel: () => {
        throw new Error('should not fall back');
      }
    })).toBe(true);
    expect(panels).toEqual([{
      actionId: 'document',
      title: 'Auth findings',
      params: {
        path: 'findings/auth.md',
        scope: 'project',
        title: 'Auth findings',
        projectId: 'p1'
      }
    }]);
  });

  it('falls back to Open in Library when the side panel declines', () => {
    const nav: Array<{ path: string; subPath?: string }> = [];
    expect(openDocFromCard({
      document: libraryDoc,
      projectId: 'p1',
      openWorkspaceFile: null,
      openThreadPanel: () => false,
      toPluginPanel: (path: string, options?: { subPath?: string }) => {
        nav.push({ path, subPath: options?.subPath });
      }
    })).toBe(false);
    expect(nav).toEqual([{ path: 'panel', subPath: 'project/p1/findings/auth.md' }]);
  });
});
