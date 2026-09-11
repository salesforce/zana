import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../store.js';

describe('pushToast persist', () => {
  afterEach(() => {
    vi.useRealTimers();
    useUi.setState({ toasts: [] });
  });

  it('auto-dismisses a normal toast after 4s', () => {
    vi.useFakeTimers();
    useUi.setState({ toasts: [] });
    const id = useUi.getState().pushToast('hello');
    expect(useUi.getState().toasts.some((t) => t.id === id)).toBe(true);
    vi.advanceTimersByTime(4000);
    expect(useUi.getState().toasts.some((t) => t.id === id)).toBe(false);
  });

  it('keeps a persist toast until dismissToast', () => {
    vi.useFakeTimers();
    useUi.setState({ toasts: [] });
    const id = useUi.getState().pushToast('Closing…', 'info', { persist: true });
    vi.advanceTimersByTime(10_000);
    expect(useUi.getState().toasts.some((t) => t.id === id)).toBe(true);
    useUi.getState().dismissToast(id);
    expect(useUi.getState().toasts.some((t) => t.id === id)).toBe(false);
  });
});
