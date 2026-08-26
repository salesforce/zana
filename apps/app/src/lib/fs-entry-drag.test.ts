import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FS_ENTRY_DRAG_MIME,
  beginFsEntryDrag,
  consumeFsEntryDragClick,
  endFsEntryDrag,
  parseFsEntryDrag,
  serializeFsEntryDrag
} from './fs-entry-drag.js';
import { POST_DRAG_CLICK_SUPPRESS_MS } from './suppress-post-drag-click.js';

describe('fs-entry-drag', () => {
  afterEach(() => {
    vi.useRealTimers();
    consumeFsEntryDragClick();
  });
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

  it('stamps the composer payload and suppresses the leftover click after dragend', () => {
    const setData = vi.fn();
    const dataTransfer = { setData, effectAllowed: 'none' } as unknown as DataTransfer;
    beginFsEntryDrag(dataTransfer, { path: '/repo/src', kind: 'dir' });
    expect(setData).toHaveBeenCalledWith('text/plain', '/repo/src');
    expect(setData).toHaveBeenCalledWith(
      FS_ENTRY_DRAG_MIME,
      serializeFsEntryDrag({ path: '/repo/src', kind: 'dir' })
    );
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(consumeFsEntryDragClick()).toBe(true);
    expect(consumeFsEntryDragClick()).toBe(false);

    beginFsEntryDrag(dataTransfer, { path: '/repo/src', kind: 'dir' });
    endFsEntryDrag();
    expect(consumeFsEntryDragClick()).toBe(true);

    vi.useFakeTimers();
    beginFsEntryDrag(dataTransfer, { path: '/repo/src', kind: 'dir' });
    endFsEntryDrag();
    vi.advanceTimersByTime(POST_DRAG_CLICK_SUPPRESS_MS);
    expect(consumeFsEntryDragClick()).toBe(false);
    vi.useRealTimers();
  });
});
