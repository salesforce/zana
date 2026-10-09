import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioComment } from '../../lib/studio-contract.js';
import { clipSelectionText, commentMarks, commentZoneHeight, debounce, selectionChipActions, toStudioDiagnostics, topicAtLine } from './studio-helpers.js';

afterEach(() => vi.useRealTimers());
const c = (id: string, line: number, extra: Partial<StudioComment> = {}): StudioComment => ({ id, path: 'a.agent', line, endLine: line, quote: 'q', body: 'hello', author: { kind: 'user', name: 'You' }, createdAt: 1, ...extra });

describe('debounce', () => {
  it('coalesces calls and can cancel', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 150);
    d(1); d(2); vi.advanceTimersByTime(149);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
    d(3); d.cancel(); vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('toStudioDiagnostics', () => {
  it('converts to 1-based, caps at 200 and normalizes severity', () => {
    const rows = Array.from({ length: 250 }, () => ({ line: 0, column: 0, endLine: 0, endColumn: 3, severity: 'weird', message: 'm'.repeat(3000), code: 7 }));
    const out = toStudioDiagnostics(rows);
    expect(out).toHaveLength(200);
    expect(out[0]).toMatchObject({ line: 1, column: 1, endLine: 1, endColumn: 4, severity: 'error', code: '7' });
    expect(out[0]!.message).toHaveLength(2000);
    expect(toStudioDiagnostics([{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'warning', message: 'w' }])[0]).toEqual({ line: 2, column: 2, endLine: 2, endColumn: 3, severity: 'warning', message: 'w' });
  });
});

describe('topics + chip', () => {
  const lines = ['config:', '  x: 1', 'topic billing:', '  reasoning:', '    a', '', 'topic refunds:', '  b', 'variables:', '  v: 1'];
  it('finds the enclosing topic', () => {
    expect(topicAtLine(lines, 5)).toBe('billing');
    expect(topicAtLine(lines, 8)).toBe('refunds');
    expect(topicAtLine(lines, 2)).toBeNull();
    expect(topicAtLine(lines, 10)).toBeNull();
    expect(topicAtLine(['start_agent main:', '  a'], 2)).toBe('main');
    expect(topicAtLine(lines, 999)).toBeNull();
  });
  it('offers preview only inside a topic', () => {
    expect(selectionChipActions(null).map(a => a.id)).toEqual(['comment', 'ask']);
    expect(selectionChipActions('t').map(a => a.id)).toEqual(['comment', 'ask', 'preview-topic']);
    expect(clipSelectionText('x'.repeat(3000))).toHaveLength(2000);
    expect(clipSelectionText('ok')).toBe('ok');
  });
});

describe('commentMarks', () => {
  it('places glyphs, expands open comments into zones, and adds hit dots', () => {
    const comments = [c('1', 3), c('2', 3, { endLine: 4 }), c('3', 50, { resolved: { at: 1, note: 'n', by: 'user' } })];
    const marks = commentMarks(comments, [3, 7, 7, 900], 10, new Set(['1', '2', '3']));
    expect(marks.glyphs.map(g => [g.line, g.className])).toEqual([[3, 'sf-comment-glyph'], [10, 'sf-comment-glyph is-resolved'], [7, 'sf-hit-glyph']]);
    expect(marks.glyphs.find(g => g.line === 3)!.ids).toEqual(['1', '2']);
    expect(marks.glyphs.filter(g => g.className === 'sf-hit-glyph').map(g => g.line)).toEqual([7]);
    expect(marks.zones).toEqual([{ afterLine: 4, comments: [comments[0], comments[1]] }]);
    expect(commentMarks(comments, [], 10, new Set()).zones).toEqual([]);
  });
  it('sizes zones', () => {
    expect(commentZoneHeight([])).toBe(2);
    expect(commentZoneHeight([c('1', 1, { body: 'x'.repeat(150) })])).toBe(4);
  });
});
