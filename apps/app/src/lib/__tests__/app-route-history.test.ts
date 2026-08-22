import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Location } from 'react-router-dom';
import {
  findBackTargetIndex,
  findForwardTargetIndex,
  getAppRouteHistoryStateForTest,
  navigateHistoryDelta,
  recordAppRouteHistoryForTest,
  reduceHistory,
  resetAppRouteHistoryForTest,
  useRouteStateHistoryNavigation,
  type AppRouteHistoryState
} from '../app-route-history.js';

function loc(key: string, url: string): Location {
  const [pathnameAndSearch, hash = ''] = url.split('#');
  const [pathname, search = ''] = pathnameAndSearch.split('?');
  return {
    key,
    pathname,
    search: search ? `?${search}` : '',
    hash: hash ? `#${hash}` : '',
    state: null
  } as Location;
}

describe('app route history', () => {
  it('pushes, drops the forward stack, and skips duplicate URLs on back', () => {
    let state: AppRouteHistoryState = { entries: [{ key: 'a', url: '/' }], index: 0 };
    state = reduceHistory(state, 'PUSH', { key: 'b', url: '/inbox' });
    state = reduceHistory(state, 'PUSH', { key: 'c', url: '/inbox' });
    state = reduceHistory(state, 'PUSH', { key: 'd', url: '/settings' });
    expect(findBackTargetIndex(state)).toBe(2);
    expect(state.entries.map((e) => e.url)).toEqual(['/', '/inbox', '/inbox', '/settings']);

    state = reduceHistory(state, 'POP', { key: 'b', url: '/inbox' });
    expect(state.index).toBe(1);
    expect(findForwardTargetIndex(state)).toBe(3);

    state = reduceHistory(state, 'PUSH', { key: 'e', url: '/agents' });
    expect(state.entries.map((e) => e.url)).toEqual(['/', '/inbox', '/agents']);
    expect(findBackTargetIndex(state)).toBe(1);
  });

  it('replaces the current slot', () => {
    let state: AppRouteHistoryState = { entries: [{ key: 'a', url: '/extensions' }], index: 0 };
    state = reduceHistory(state, 'REPLACE', { key: 'b', url: '/extensions/plugins' });
    expect(state).toEqual({ entries: [{ key: 'b', url: '/extensions/plugins' }], index: 0 });
  });

  it('resets on POP of an unrecorded location and ignores empty stacks', () => {
    const empty: AppRouteHistoryState = { entries: [], index: 0 };
    expect(findBackTargetIndex(empty)).toBeNull();
    expect(findForwardTargetIndex(empty)).toBeNull();

    const reset = reduceHistory(
      { entries: [{ key: 'a', url: '/' }], index: 0 },
      'POP',
      { key: 'missing', url: '/inbox' }
    );
    expect(reset).toEqual({ entries: [{ key: 'missing', url: '/inbox' }], index: 0 });
  });

  it('does not step when every adjacent slot is the same URL', () => {
    const state: AppRouteHistoryState = {
      entries: [
        { key: 'a', url: '/inbox' },
        { key: 'b', url: '/inbox' }
      ],
      index: 1
    };
    expect(findBackTargetIndex(state)).toBeNull();
    expect(findForwardTargetIndex({ ...state, index: 0 })).toBeNull();
  });

  it('navigates by delta only when a distinct target exists', () => {
    const state: AppRouteHistoryState = {
      entries: [
        { key: 'a', url: '/' },
        { key: 'b', url: '/inbox' }
      ],
      index: 1
    };
    const deltas: number[] = [];
    navigateHistoryDelta(state, 'back', (delta) => deltas.push(delta));
    navigateHistoryDelta(state, 'forward', (delta) => deltas.push(delta));
    navigateHistoryDelta({ entries: [], index: 0 }, 'back', (delta) => deltas.push(delta));
    expect(deltas).toEqual([-1]);
  });

  it('records PUSH/REPLACE/POP and skips a duplicate location object', () => {
    resetAppRouteHistoryForTest();
    const first = loc('a', '/');
    recordAppRouteHistoryForTest(first, 'PUSH');
    recordAppRouteHistoryForTest(first, 'PUSH');
    recordAppRouteHistoryForTest(loc('b', '/inbox?x=1#h'), 'PUSH');
    recordAppRouteHistoryForTest(loc('c', '/settings'), 'REPLACE');
    recordAppRouteHistoryForTest(loc('unseen', '/agents'), 'POP');
    expect(getAppRouteHistoryStateForTest()).toEqual({
      entries: [{ key: 'unseen', url: '/agents' }],
      index: 0
    });
    resetAppRouteHistoryForTest();
    expect(getAppRouteHistoryStateForTest()).toEqual({ entries: [], index: 0 });
  });

  it('mounts the history hook against a memory router', () => {
    resetAppRouteHistoryForTest();
    function Probe() {
      const nav = useRouteStateHistoryNavigation();
      nav.goBack();
      nav.goForward();
      return createElement('div', {
        'data-back': String(nav.canGoBack),
        'data-forward': String(nav.canGoForward)
      });
    }
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(Probe))
    );
    expect(markup).toContain('data-back="false"');
    expect(markup).toContain('data-forward="false"');
  });
});

describe('app route history', () => {
  it('pushes, drops the forward stack, and skips duplicate URLs on back', () => {
    let state: AppRouteHistoryState = { entries: [{ key: 'a', url: '/' }], index: 0 };
    state = reduceHistory(state, 'PUSH', { key: 'b', url: '/inbox' });
    state = reduceHistory(state, 'PUSH', { key: 'c', url: '/inbox' });
    state = reduceHistory(state, 'PUSH', { key: 'd', url: '/settings' });
    expect(findBackTargetIndex(state)).toBe(2);
    expect(state.entries.map((e) => e.url)).toEqual(['/', '/inbox', '/inbox', '/settings']);

    state = reduceHistory(state, 'POP', { key: 'b', url: '/inbox' });
    expect(state.index).toBe(1);
    expect(findForwardTargetIndex(state)).toBe(3);

    state = reduceHistory(state, 'PUSH', { key: 'e', url: '/agents' });
    expect(state.entries.map((e) => e.url)).toEqual(['/', '/inbox', '/agents']);
    expect(findBackTargetIndex(state)).toBe(1);
  });

  it('replaces the current slot', () => {
    let state: AppRouteHistoryState = { entries: [{ key: 'a', url: '/extensions' }], index: 0 };
    state = reduceHistory(state, 'REPLACE', { key: 'b', url: '/extensions/plugins' });
    expect(state).toEqual({ entries: [{ key: 'b', url: '/extensions/plugins' }], index: 0 });
  });
});
