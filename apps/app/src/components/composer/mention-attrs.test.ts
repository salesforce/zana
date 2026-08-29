import { describe, expect, it } from 'vitest';
import { mentionAttrsForSuggestion } from './mention-attrs.js';

describe('mentionAttrsForSuggestion', () => {
  it('stores a workspace path resource and @-prefixed serialized text', () => {
    expect(mentionAttrsForSuggestion({
      kind: 'path',
      path: 'src/foo.ts',
      name: 'foo.ts',
      entryKind: 'file'
    })).toMatchObject({
      id: 'path:src/foo.ts',
      label: 'foo.ts',
      serializedText: '@src/foo.ts',
      resource: {
        kind: 'path',
        source: 'workspace',
        entryKind: 'file',
        path: 'src/foo.ts'
      }
    });
  });

  it('stores a command pill without a leading slash in the label', () => {
    expect(mentionAttrsForSuggestion({
      kind: 'command',
      name: '/plan',
      description: 'Enter plan mode'
    })).toMatchObject({
      label: 'plan',
      serializedText: '/plan',
      resource: { kind: 'command', name: 'plan', trigger: '/' }
    });
  });

  it('labels a thread pill Agent: <title> while serializing the bare title', () => {
    expect(mentionAttrsForSuggestion({
      kind: 'thread',
      threadId: 't1',
      projectId: 'p1',
      title: 'Hello',
      projectName: 'Zana'
    })).toMatchObject({
      label: 'Agent: Hello',
      serializedText: '@Hello',
      resource: { kind: 'thread', threadId: 't1', label: 'Hello' }
    });
  });
});
