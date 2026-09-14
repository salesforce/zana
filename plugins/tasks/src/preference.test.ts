/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadFilters, loadSort, loadViewMode, storeFilters, storeSort, storeViewMode } from './preference.js';

afterEach(() => {
  localStorage.clear();
});

describe('tasks preferences', () => {
  it('defaults then round-trips view, sort, and filters', () => {
    expect(loadViewMode()).toBe('list');
    expect(loadSort()).toBe('manual');
    expect(loadFilters()).toEqual({ statuses: [], priorities: [] });
    storeViewMode('board');
    storeSort('due');
    storeFilters({ statuses: ['todo'], priorities: ['high'] });
    expect(loadViewMode()).toBe('board');
    expect(loadSort()).toBe('due');
    expect(loadFilters()).toEqual({ statuses: ['todo'], priorities: ['high'] });
  });

  it('ignores corrupt filter JSON and unknown enum values', () => {
    localStorage.setItem('zcc-tasks:filters', '{');
    expect(loadFilters()).toEqual({ statuses: [], priorities: [] });
    localStorage.setItem(
      'zcc-tasks:filters',
      JSON.stringify({ statuses: ['todo', 'nope'], priorities: ['high', 'wild'] })
    );
    expect(loadFilters()).toEqual({ statuses: ['todo'], priorities: ['high'] });
    localStorage.setItem('zcc-tasks:sort', 'nope');
    expect(loadSort()).toBe('manual');
  });
});
