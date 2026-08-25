import { describe, expect, it } from 'vitest';
import { parseFsEntryDrag, serializeFsEntryDrag } from './fs-entry-drag.js';

describe('fs-entry-drag', () => {
  it('round-trips a file or directory payload', () => {
    expect(parseFsEntryDrag(serializeFsEntryDrag({ path: '/repo/src/a.ts', kind: 'file' }))).toEqual([
      { path: '/repo/src/a.ts', kind: 'file' }
    ]);
    expect(parseFsEntryDrag(serializeFsEntryDrag({ path: '/repo/src', kind: 'dir' }))).toEqual([
      { path: '/repo/src', kind: 'dir' }
    ]);
  });

  it('accepts an array of payloads and drops malformed rows', () => {
    expect(parseFsEntryDrag(JSON.stringify([
      { path: '/repo/a.ts', kind: 'file' },
      { path: '', kind: 'file' },
      { path: '/repo/b', kind: 'symlink' },
      { kind: 'dir' }
    ]))).toEqual([{ path: '/repo/a.ts', kind: 'file' }]);
  });

  it('returns nothing for empty or invalid JSON', () => {
    expect(parseFsEntryDrag('')).toEqual([]);
    expect(parseFsEntryDrag('{')).toEqual([]);
    expect(parseFsEntryDrag('null')).toEqual([]);
  });
});
