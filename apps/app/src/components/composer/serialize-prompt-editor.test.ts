import { describe, expect, it } from 'vitest';
import { serializePromptEditor } from './serialize-prompt-editor.js';

describe('serializePromptEditor', () => {
  it('serializes plain paragraphs with newlines between blocks', () => {
    expect(serializePromptEditor({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'world' }] }
      ]
    })).toEqual({ text: 'hello\nworld', mentions: [] });
  });

  it('records mention offsets using serializedText', () => {
    const result = serializePromptEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see ' },
            {
              type: 'mention',
              attrs: {
                serializedText: '@src/foo.ts',
                label: 'foo.ts',
                resource: {
                  kind: 'path',
                  source: 'workspace',
                  entryKind: 'file',
                  path: 'src/foo.ts',
                  label: 'foo.ts'
                }
              }
            },
            { type: 'text', text: ' please' }
          ]
        }
      ]
    });
    expect(result.text).toBe('see @src/foo.ts please');
    expect(result.mentions).toEqual([
      {
        start: 4,
        end: 15,
        resource: {
          kind: 'path',
          source: 'workspace',
          entryKind: 'file',
          path: 'src/foo.ts',
          label: 'foo.ts'
        }
      }
    ]);
  });

  it('serializes command pills', () => {
    const result = serializePromptEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'mention',
          attrs: {
            serializedText: '/plan',
            resource: {
              kind: 'command',
              trigger: '/',
              name: 'plan',
              source: 'command',
              origin: 'builtin',
              label: 'plan',
              argumentHint: null
            }
          }
        }]
      }]
    });
    expect(result.text).toBe('/plan');
    expect(result.mentions[0]?.resource).toMatchObject({ kind: 'command', name: 'plan' });
  });

  it('skips malformed mention resources', () => {
    const result = serializePromptEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'mention',
          attrs: { serializedText: '@x', resource: { kind: 'nope' } }
        }]
      }]
    });
    expect(result).toEqual({ text: '@x', mentions: [] });
  });
});


it('expands a selection snapshot at its inline position without granting path access', () => {
  const selection = { version: 1, path: 'Review.agent', startLine: 12, endLine: 13, text: 'unsaved code\n  keep whitespace' };
  const result = serializePromptEditor({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Explain ' },
    { type: 'editorSelection', attrs: { selection } },
    { type: 'text', text: ' please' },
    { type: 'editorSelection', attrs: { selection: { ...selection, startLine: -1 } } }
  ] }] });
  expect(result.text).toContain('Explain \n\nReview.agent:12–13 (copied selection)');
  expect(result.text).toContain('unsaved code\n  keep whitespace');
  expect(result.text).toMatch(/ please$/);
  expect(result.mentions).toEqual([]);
});
