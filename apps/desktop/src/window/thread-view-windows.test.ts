import { describe, expect, it } from 'vitest';
import {
  authorizeThreadView,
  cascadeThreadViewPosition,
  listThreadViews,
  parseThreadViewTarget,
  readThreadViewBounds,
  sameThreadView,
  threadViewRendererParams,
  THREAD_VIEW_CASCADE_PX,
  writeThreadViewBounds
} from './thread-view-windows.js';

describe('parseThreadViewTarget', () => {
  it('keeps a thread id and an optional project id, dropping anything else', () => {
    expect(parseThreadViewTarget({ threadId: 'a1b2-c3', projectId: 'p-1', extra: 'x' })).toEqual({ threadId: 'a1b2-c3', projectId: 'p-1' });
    expect(parseThreadViewTarget({ threadId: 'thr_1.2:3' })).toEqual({ threadId: 'thr_1.2:3' });
    expect(parseThreadViewTarget({ threadId: 't1', projectId: null })).toEqual({ threadId: 't1' });
  });

  it.each([
    ['nothing', undefined],
    ['a string', 't1'],
    ['no thread id', { projectId: 'p-1' }],
    ['a path-like thread id', { threadId: '../t1' }],
    ['a thread id that is too long', { threadId: 't'.repeat(129) }],
    ['a blank project id', { threadId: 't1', projectId: '  ' }],
    ['a project id that is not a string', { threadId: 't1', projectId: 4 }],
    ['a project id that is too long', { threadId: 't1', projectId: 'p'.repeat(257) }],
    ['a control character in the project id', { threadId: 't1', projectId: 'p\u00011' }]
  ])('refuses %s', (_label, input) => {
    expect(parseThreadViewTarget(input)).toBeNull();
  });
});

describe('authorizeThreadView', () => {
  it('opens a thread of a registered project, or one with no project', () => {
    expect(authorizeThreadView({ threadId: 't1', projectId: 'p-1' }, { projectIds: ['p-1'] })).toEqual({ ok: true, target: { threadId: 't1', projectId: 'p-1' } });
    expect(authorizeThreadView({ threadId: 't1' }, { projectIds: [] })).toEqual({ ok: true, target: { threadId: 't1' } });
  });

  it('refuses a malformed target and an unknown project', () => {
    expect(authorizeThreadView({ threadId: '' }, { projectIds: ['p-1'] })).toEqual({ ok: false, reason: 'invalid' });
    expect(authorizeThreadView({ threadId: 't1', projectId: 'p-9' }, { projectIds: ['p-1'] })).toEqual({ ok: false, reason: 'unknown-project' });
  });
});

it('matches thread windows by thread alone', () => {
  expect(sameThreadView({ threadId: 't1', projectId: 'p-1' }, { threadId: 't1' })).toBe(true);
  expect(sameThreadView({ threadId: 't1' }, { threadId: 't2' })).toBe(false);
  expect(sameThreadView(undefined, { threadId: 't1' })).toBe(false);
});

it('names the surface, the thread and its project for the renderer', () => {
  expect(threadViewRendererParams({ threadId: 't1', projectId: 'p-1' })).toEqual({ surface: 'thread-view', threadId: 't1', projectId: 'p-1' });
  expect(threadViewRendererParams({ threadId: 't1' })).toEqual({ surface: 'thread-view', threadId: 't1' });
});

it('lists only live thread windows, as copies', () => {
  const view = { threadId: 't1' };
  const listed = listThreadViews([{ threadView: view, live: true }, { threadView: { threadId: 't2' }, live: false }, { live: true }]);
  expect(listed).toEqual([view]);
  expect(listed[0]).not.toBe(view);
});

describe('thread window geometry', () => {
  it('reads the saved geometry, defaulting to not maximized', () => {
    expect(readThreadViewBounds(undefined)).toEqual({ bounds: undefined, maximized: false });
    expect(readThreadViewBounds({ bounds: { width: 900, height: 700 }, maximized: true })).toEqual({ bounds: { width: 900, height: 700 }, maximized: true });
  });

  it('writes the new bounds, or keeps the old ones while only the maximize flag changed', () => {
    expect(writeThreadViewBounds(undefined, { windowBounds: { x: 1, y: 2, width: 900, height: 700 } })).toEqual({ bounds: { x: 1, y: 2, width: 900, height: 700 } });
    expect(writeThreadViewBounds({ bounds: { width: 900, height: 700 } }, { windowMaximized: true })).toEqual({ bounds: { width: 900, height: 700 }, maximized: true });
    expect(writeThreadViewBounds(undefined, { windowMaximized: false })).toEqual({});
  });

  it('steps a new window off open ones at the same spot', () => {
    const step = THREAD_VIEW_CASCADE_PX;
    expect(cascadeThreadViewPosition({ x: 10, y: 20 }, [])).toEqual({ x: 10, y: 20 });
    expect(cascadeThreadViewPosition({ x: 10, y: 20 }, [{ x: 500, y: 500 }])).toEqual({ x: 10, y: 20 });
    expect(cascadeThreadViewPosition({ x: 10, y: 20 }, [{ x: 10, y: 20 }, { x: 10 + step, y: 20 + step }])).toEqual({ x: 10 + 2 * step, y: 20 + 2 * step });
  });
});
