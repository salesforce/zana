// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { canAutomaticallyFocus } from './automatic-focus.js';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it('allows autofocus only when focus is empty or already belongs to the target', () => {
  const target = document.createElement('div');
  const inside = document.createElement('input');
  const outside = document.createElement('textarea');
  target.append(inside);
  document.body.append(target, outside);
  expect(canAutomaticallyFocus(target)).toBe(true);
  target.tabIndex = -1;
  target.focus();
  expect(canAutomaticallyFocus(inside)).toBe(true);
  inside.focus();
  expect(canAutomaticallyFocus(target)).toBe(true);
  outside.focus();
  expect(canAutomaticallyFocus(target)).toBe(false);
  vi.spyOn(document, 'activeElement', 'get').mockReturnValue(document.documentElement);
  expect(canAutomaticallyFocus(target)).toBe(true);
  vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);
  expect(canAutomaticallyFocus(target)).toBe(true);
});
