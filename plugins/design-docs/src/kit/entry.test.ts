// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';

const enhance = vi.fn();
const createKit = vi.fn(() => ({ enhance }));
vi.mock('./index.js', () => ({ createKit }));

afterEach(() => {
  Reflect.deleteProperty(document, 'readyState');
  Reflect.deleteProperty(window, 'Kit');
  enhance.mockClear();
  vi.resetModules();
});

it('exposes the kit on window and enhances a parsed page at once', async () => {
  await import('./entry.js');
  expect(createKit).toHaveBeenCalledWith(window);
  expect((window as unknown as { Kit: unknown }).Kit).toEqual({ enhance });
  expect(enhance).toHaveBeenCalledTimes(1);
});

it('waits for DOMContentLoaded while the page is still loading', async () => {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
  await import('./entry.js');
  expect(enhance).not.toHaveBeenCalled();
  document.dispatchEvent(new Event('DOMContentLoaded'));
  document.dispatchEvent(new Event('DOMContentLoaded'));
  expect(enhance).toHaveBeenCalledTimes(1);
});
