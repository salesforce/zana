// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';

const startPageRuntime = vi.fn();
vi.mock('./page-runtime.js', () => ({ startPageRuntime }));

afterEach(() => {
  Reflect.deleteProperty(window, '__ddPage');
  Reflect.deleteProperty(document, 'currentScript');
  startPageRuntime.mockClear();
  vi.resetModules();
});

it('starts the runtime once and removes its own script tag', async () => {
  const script = document.createElement('script');
  document.head.appendChild(script);
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => script });
  await import('./entry.js');
  expect(startPageRuntime).toHaveBeenCalledWith(window);
  expect(script.isConnected).toBe(false);
});

it('leaves an already started page alone, with or without a current script', async () => {
  Object.defineProperty(window, '__ddPage', { configurable: true, value: {} });
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => null });
  await import('./entry.js');
  expect(startPageRuntime).not.toHaveBeenCalled();
});
