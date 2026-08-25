import { describe, expect, it } from 'vitest';
import {
  mentionDisplayLabel,
  mentionKindTitle,
  mentionResourceValue
} from './mention-label.js';

describe('mentionDisplayLabel', () => {
  it('prefixes thread and project values with their kind title', () => {
    expect(mentionDisplayLabel({ kind: 'thread', label: 'Hello' })).toBe('Thread: Hello');
    expect(mentionDisplayLabel({ kind: 'project', label: 'Zana' })).toBe('Project: Zana');
  });

  it('keeps file and command values unprefixed', () => {
    expect(mentionDisplayLabel({ kind: 'path', label: 'foo.ts', path: 'src/foo.ts' })).toBe('foo.ts');
    expect(mentionDisplayLabel({ kind: 'command', name: 'plan' })).toBe('plan');
  });

  it('does not double-prefix an already titled thread label', () => {
    expect(mentionDisplayLabel({ kind: 'thread', label: 'Thread: Hello' })).toBe('Thread: Hello');
  });

  it('falls back through label, path, name, and kind', () => {
    expect(mentionResourceValue({ kind: 'path', path: 'a.ts' })).toBe('a.ts');
    expect(mentionResourceValue({ kind: 'command', name: 'help' })).toBe('help');
    expect(mentionResourceValue({ kind: 'thread' })).toBe('thread');
    expect(mentionResourceValue()).toBe('');
    expect(mentionKindTitle({ kind: 'path', entryKind: 'directory' })).toBe('Folder');
    expect(mentionKindTitle({ kind: 'path', entryKind: 'file' })).toBe('File');
    expect(mentionDisplayLabel({})).toBe('');
  });
});
