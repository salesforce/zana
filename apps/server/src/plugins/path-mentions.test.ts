import { describe, expect, it, vi } from 'vitest';
import {
  collectPathMentionResources,
  PATH_MENTION_BODY_CAP,
  withResolvedPathMentionContext
} from './path-mentions.js';

describe('path mentions', () => {
  it('collects unique file paths and skips directories', () => {
    expect(collectPathMentionResources([
      {
        type: 'text',
        text: 'see @src/foo.ts and @src and @src/foo.ts',
        mentions: [
          {
            start: 4,
            end: 15,
            resource: { kind: 'path', path: 'src/foo.ts' }
          },
          {
            start: 20,
            end: 24,
            resource: { kind: 'path', source: 'workspace', entryKind: 'directory', path: 'src', label: 'src' }
          },
          {
            start: 29,
            end: 40,
            resource: {
              kind: 'path',
              source: 'workspace',
              entryKind: 'file',
              path: 'src/foo.ts',
              label: 'foo.ts'
            }
          },
          {
            start: 41,
            end: 50,
            resource: {
              kind: 'path',
              source: 'thread-storage',
              entryKind: 'file',
              path: 'notes.md',
              label: 'notes.md'
            }
          },
          {
            start: 51,
            end: 55,
            resource: { kind: 'plugin', pluginId: 'docs', itemId: 'doc:1', label: 'Doc' }
          }
        ]
      }
    ])).toEqual([
      { kind: 'path', source: 'workspace', entryKind: 'file', path: 'src/foo.ts', label: 'foo.ts' },
      {
        kind: 'path',
        source: 'thread-storage',
        entryKind: 'file',
        path: 'notes.md',
        label: 'notes.md'
      }
    ]);
  });

  it('appends capped utf8 bodies and skips missing, binary, and confine failures', async () => {
    const readWorkspaceFile = vi.fn(async (path: string) => {
      if (path === 'src/foo.ts') return { content: 'export const x = 1;\n', encoding: 'utf8' as const };
      if (path === 'logo.png') return { content: 'aaaa', encoding: 'base64' as const };
      if (path === 'missing.ts') return null;
      throw new Error('escaped');
    });
    const readStorageFile = vi.fn(async () => ({
      content: `${'a'.repeat(PATH_MENTION_BODY_CAP + 12)}`,
      encoding: 'utf8' as const
    }));
    const input = [{
      type: 'text',
      text: 'see files',
      mentions: [
        { start: 0, end: 1, resource: { kind: 'path', path: 'src/foo.ts', label: 'foo.ts' } },
        { start: 2, end: 3, resource: { kind: 'path', path: 'logo.png', label: 'logo.png' } },
        { start: 4, end: 5, resource: { kind: 'path', path: 'missing.ts' } },
        { start: 6, end: 7, resource: { kind: 'path', path: '../secret' } },
        {
          start: 8,
          end: 9,
          resource: { kind: 'path', source: 'thread-storage', path: 'notes.md', label: 'notes.md' }
        }
      ]
    }];
    const next = await withResolvedPathMentionContext(input, { readWorkspaceFile, readStorageFile });
    expect(readWorkspaceFile).toHaveBeenCalledWith('src/foo.ts');
    expect(next).toEqual([
      ...input,
      {
        type: 'text',
        visibility: 'agent-only',
        mentions: [],
        text: 'Context for @foo.ts (workspace file "src/foo.ts"):\n\nexport const x = 1;\n'
      },
      {
        type: 'text',
        visibility: 'agent-only',
        mentions: [],
        text: expect.stringMatching(/^Context for @notes\.md \(thread storage file "notes\.md"\):\n\n[\s\S]+\n…$/)
      }
    ]);
    const storagePart = (next as Array<{ text: string }>)[2]!;
    expect(storagePart.text.length).toBeLessThan(PATH_MENTION_BODY_CAP + 80);
  });

  it('does not throw when a reader is missing for storage mentions', async () => {
    const next = await withResolvedPathMentionContext([{
      type: 'text',
      text: '@notes.md',
      mentions: [{
        start: 0,
        end: 9,
        resource: { kind: 'path', source: 'thread-storage', path: 'notes.md', label: 'notes.md' }
      }]
    }], {
      readWorkspaceFile: async () => ({ content: 'nope', encoding: 'utf8' })
    });
    expect(next).toEqual([{
      type: 'text',
      text: '@notes.md',
      mentions: [{
        start: 0,
        end: 9,
        resource: { kind: 'path', source: 'thread-storage', path: 'notes.md', label: 'notes.md' }
      }]
    }]);
  });
});
