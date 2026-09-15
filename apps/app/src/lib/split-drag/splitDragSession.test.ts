import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('beginSplitDrag leftover click', () => {
  it('uses suppressPostDragClick instead of a window-only swallow', () => {
    const source = readFileSync(new URL('./splitDragSession.ts', import.meta.url), 'utf8');
    expect(source).toContain('suppressPostDragClick()');
    expect(source).toContain("from '../suppress-post-drag-click.js'");
    expect(source).not.toContain('swallowNextClick');
    expect(source).not.toContain("window.addEventListener('click'");
    expect(source).toContain('if (wasEngaged) suppressPostDragClick();');
    expect(source).toContain('config.onEnd?.({ dropped: dropTarget !== null })');
    expect(source).toContain('config.onEnd?.({ dropped: false })');
  });
});
