import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('explorer path drags', () => {
  it('stamps the composer payload so dropped folders keep their kind', () => {
    const tree = readFileSync(new URL('./TreeList.tsx', import.meta.url), 'utf8');
    const changes = readFileSync(new URL('./ChangesList.tsx', import.meta.url), 'utf8');
    expect(tree).toContain('FS_ENTRY_DRAG_MIME');
    expect(tree).toContain('serializeFsEntryDrag');
    expect(tree).toContain('kind: entry.kind');
    expect(changes).toContain('FS_ENTRY_DRAG_MIME');
    expect(changes).toContain("kind: 'file'");
  });
});
