import { describe, expect, it } from 'vitest';
import { FS_ENTRY_DRAG_MIME, serializeFsEntryDrag } from '../../lib/fs-entry-drag.js';
import {
  droppedPathsFromDataTransfer,
  isComposerPathDrag,
  mentionContentForDroppedPaths,
  workspaceRelativeDroppedPath
} from './composer-file-drop.js';

describe('workspaceRelativeDroppedPath', () => {
  it('strips the project root and keeps the basename', () => {
    expect(workspaceRelativeDroppedPath('/repo/src/foo.ts', '/repo')).toEqual({
      path: 'src/foo.ts',
      name: 'foo.ts'
    });
  });

  it('maps the project root itself to .', () => {
    expect(workspaceRelativeDroppedPath('/repo/', '/repo')).toEqual({ path: '.', name: 'repo' });
  });

  it('keeps paths outside the project absolute', () => {
    expect(workspaceRelativeDroppedPath('/other/a.ts', '/repo')).toEqual({
      path: '/other/a.ts',
      name: 'a.ts'
    });
  });

  it('keeps the original path when no project root is given', () => {
    expect(workspaceRelativeDroppedPath('/repo/a.ts')).toEqual({
      path: '/repo/a.ts',
      name: 'a.ts'
    });
  });
});

describe('isComposerPathDrag', () => {
  it('accepts OS files and explorer entries, not bare text', () => {
    expect(isComposerPathDrag(['Files'])).toBe(true);
    expect(isComposerPathDrag([FS_ENTRY_DRAG_MIME, 'text/plain'])).toBe(true);
    expect(isComposerPathDrag(['text/plain'])).toBe(false);
  });
});

describe('droppedPathsFromDataTransfer', () => {
  it('resolves OS files and directory entries against the project root', () => {
    const file = { name: 'foo.ts' } as File;
    const folder = { name: 'src' } as File;
    expect(droppedPathsFromDataTransfer({
      types: ['Files'],
      files: [file, folder],
      items: [
        { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) },
        { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }
      ],
      getData: () => '',
      pathForFile: (next) => (next === file ? '/repo/src/foo.ts' : '/repo/src'),
      projectRoot: '/repo'
    })).toEqual([
      { path: 'src/foo.ts', name: 'foo.ts', entryKind: 'file' },
      { path: 'src', name: 'src', entryKind: 'directory' }
    ]);
  });

  it('skips non-file data-transfer items when classifying directories', () => {
    expect(droppedPathsFromDataTransfer({
      types: ['Files', 'text/plain'],
      files: [{ name: 'src' } as File],
      items: [
        { kind: 'string' },
        { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }
      ],
      getData: () => '',
      pathForFile: () => '/repo/src',
      projectRoot: '/repo'
    })).toEqual([{ path: 'src', name: 'src', entryKind: 'directory' }]);
  });

  it('skips files whose path cannot be resolved', () => {
    expect(droppedPathsFromDataTransfer({
      types: ['Files'],
      files: [{ name: 'secret' } as File],
      getData: () => '/repo/ignored.ts',
      pathForFile: () => {
        throw new Error('not a dropped file');
      },
      projectRoot: '/repo'
    })).toEqual([]);
  });

  it('prefers the explorer payload over plain text so folders keep their kind', () => {
    expect(droppedPathsFromDataTransfer({
      types: [FS_ENTRY_DRAG_MIME, 'text/plain'],
      files: [],
      getData: (type) => (
        type === FS_ENTRY_DRAG_MIME
          ? serializeFsEntryDrag({ path: '/repo/src', kind: 'dir' })
          : '/repo/src'
      ),
      pathForFile: () => '',
      projectRoot: '/repo'
    })).toEqual([{ path: 'src', name: 'src', entryKind: 'directory' }]);
  });

  it('falls back to absolute text/plain paths from the explorer', () => {
    expect(droppedPathsFromDataTransfer({
      types: ['text/plain'],
      files: [],
      getData: (type) => (type === 'text/plain' ? '/repo/README.md\nnot-a-path' : ''),
      pathForFile: () => '',
      projectRoot: '/repo'
    })).toEqual([{ path: 'README.md', name: 'README.md', entryKind: 'file' }]);
  });

  it('ignores in-editor text drags that are not absolute paths', () => {
    expect(droppedPathsFromDataTransfer({
      types: ['text/plain'],
      files: [],
      getData: () => 'selected prompt text',
      pathForFile: () => '',
      projectRoot: '/repo'
    })).toEqual([]);
  });

  it('dedupes the same path dropped twice', () => {
    expect(droppedPathsFromDataTransfer({
      types: ['text/plain'],
      files: [],
      getData: () => '/repo/a.ts\n/repo/a.ts',
      pathForFile: () => '',
      projectRoot: '/repo'
    })).toEqual([{ path: 'a.ts', name: 'a.ts', entryKind: 'file' }]);
  });
});

describe('mentionContentForDroppedPaths', () => {
  it('inserts a mention pill plus a trailing space for each path', () => {
    expect(mentionContentForDroppedPaths([
      { path: 'src/foo.ts', name: 'foo.ts', entryKind: 'file' }
    ])).toEqual([
      {
        type: 'mention',
        attrs: {
          id: 'path:src/foo.ts',
          label: 'foo.ts',
          serializedText: '@src/foo.ts',
          resource: {
            kind: 'path',
            source: 'workspace',
            entryKind: 'file',
            path: 'src/foo.ts',
            label: 'foo.ts'
          }
        }
      },
      { type: 'text', text: ' ' }
    ]);
  });
});
