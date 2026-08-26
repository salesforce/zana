import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('explorer path drags', () => {
  it('stamps the composer payload so dropped folders keep their kind', () => {
    const tree = readFileSync(new URL('./TreeList.tsx', import.meta.url), 'utf8');
    const changes = readFileSync(new URL('./ChangesList.tsx', import.meta.url), 'utf8');
    expect(tree).toContain('beginFsEntryDrag');
    expect(tree).toContain('consumeFsEntryDragClick');
    expect(tree).toContain('endFsEntryDrag');
    expect(tree).toContain('kind: entry.kind');
    expect(changes).toContain('beginFsEntryDrag');
    expect(changes).toContain('consumeFsEntryDragClick');
    expect(changes).toContain('endFsEntryDrag');
    expect(changes).toContain("kind: 'file'");
  });
});
