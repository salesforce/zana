/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { readDismissedSquadRuns, saveSquadRunDismissal, subscribeToSquadRunDismissals } from './squadRunDismissals';

const key = 'zcc.squadRunDismissals.v1';

afterEach(() => localStorage.clear());

it('ignores invalid data and bounds storage to recent dismissals', () => {
  localStorage.setItem(key, 'invalid JSON');
  expect(readDismissedSquadRuns('project')).toEqual(new Set());
  localStorage.setItem(key, '{}');
  expect(readDismissedSquadRuns('project')).toEqual(new Set());
  const history = Array.from({ length: 250 }, (_, index) => ['project', String(index)]);
  localStorage.setItem(key, JSON.stringify([['project'], [true, 'invalid'], ...history]));
  saveSquadRunDismissal('other-project', 'new-run', true);
  const entries = readDismissedSquadRuns('project');
  expect(entries.size).toBe(249);
  expect(entries.has('0')).toBe(false);
  expect(readDismissedSquadRuns('other-project')).toEqual(new Set(['new-run']));
  saveSquadRunDismissal('other-project', 'new-run', false);
  expect(readDismissedSquadRuns('other-project')).toEqual(new Set());
});

it('refreshes other windows for dismissal changes and removes the listener on cleanup', () => {
  const onChange = vi.fn();
  const unsubscribe = subscribeToSquadRunDismissals(onChange);
  window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
  window.dispatchEvent(new StorageEvent('storage', { key }));
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
  expect(onChange).toHaveBeenCalledTimes(2);
  unsubscribe();
  window.dispatchEvent(new StorageEvent('storage', { key }));
  expect(onChange).toHaveBeenCalledTimes(2);
});
