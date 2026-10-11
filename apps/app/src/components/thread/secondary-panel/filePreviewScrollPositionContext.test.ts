import { describe, expect, it } from 'vitest';
import {
  filePreviewScrollPositionFor,
  pruneFilePreviewScrollPositions,
  type FilePreviewScrollPositions
} from './filePreviewScrollPositionContext.js';

describe('file preview scroll positions', () => {
  it('hands out one stable, zeroed position per tab id', () => {
    const positions: FilePreviewScrollPositions = new Map();
    const first = filePreviewScrollPositionFor(positions, 'a');
    expect(first).toEqual({ scrollTop: 0 });
    first.scrollTop = 480;
    expect(filePreviewScrollPositionFor(positions, 'a')).toBe(first);
    expect(filePreviewScrollPositionFor(positions, 'b')).not.toBe(first);
    expect(positions.size).toBe(2);
  });

  it('drops only the entries whose tab is no longer open', () => {
    const positions: FilePreviewScrollPositions = new Map();
    for (const id of ['a', 'b', 'c']) filePreviewScrollPositionFor(positions, id).scrollTop = 10;
    pruneFilePreviewScrollPositions(positions, ['a', 'c', 'unrelated-pin']);
    expect([...positions.keys()]).toEqual(['a', 'c']);
    pruneFilePreviewScrollPositions(positions, []);
    expect(positions.size).toBe(0);
  });

  it('starts a reopened tab id from the top', () => {
    const positions: FilePreviewScrollPositions = new Map();
    filePreviewScrollPositionFor(positions, 'a').scrollTop = 900;
    pruneFilePreviewScrollPositions(positions, ['b']);
    expect(filePreviewScrollPositionFor(positions, 'a').scrollTop).toBe(0);
  });
});
