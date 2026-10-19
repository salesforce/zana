// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMessageOverflow } from './useMessageOverflow.js';

function Probe({ enabled, text }: { enabled: boolean; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const overflowing = useMessageOverflow(ref, enabled, text);
  return <div ref={ref} data-testid="probe" data-overflowing={String(overflowing)}>{text}</div>;
}

describe('useMessageOverflow', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('measures on mount, re-measures on resize, and disconnects on unmount', () => {
    let callback: ResizeObserverCallback = () => undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(next: ResizeObserverCallback) { callback = next; }
      observe = observe;
      disconnect = disconnect;
      unobserve() {}
    });
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
    const view = render(<Probe enabled text="a" />);
    const probe = view.getByTestId('probe');
    expect(probe.dataset.overflowing).toBe('false');
    expect(observe).toHaveBeenCalledWith(probe);
    scroll.mockReturnValue(300);
    act(() => callback([], {} as ResizeObserver));
    expect(probe.dataset.overflowing).toBe('true');
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('reports no overflow while disabled and measures once without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
    const view = render(<Probe enabled={false} text="a" />);
    expect(view.getByTestId('probe').dataset.overflowing).toBe('false');
    view.rerender(<Probe enabled text="a" />);
    expect(view.getByTestId('probe').dataset.overflowing).toBe('true');
  });
});
