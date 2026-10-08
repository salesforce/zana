// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useWidthTier } from './hooks.js';

const BREAKPOINTS = [400, 800] as const;

function Probe({ width, show = true }: { width: number; show?: boolean }) {
  const [ref, tier] = useWidthTier(BREAKPOINTS);
  return (
    <div>
      <output data-testid="tier">{tier === null ? 'none' : String(tier)}</output>
      {show ? <div ref={(el) => { if (el) el.getBoundingClientRect = () => ({ width } as DOMRect); ref(el); }} /> : null}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('measures before paint and follows resizes by tier', () => {
  let notify: ResizeObserverCallback = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { notify = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const view = render(<Probe width={500} />);
  expect(view.getByTestId('tier').textContent).toBe('1');
  act(() => notify([{ contentRect: { width: 900 } } as ResizeObserverEntry], {} as ResizeObserver));
  expect(view.getByTestId('tier').textContent).toBe('2');
  // An observer report without an entry is treated as no width yet.
  act(() => notify([], {} as ResizeObserver));
  expect(view.getByTestId('tier').textContent).toBe('none');
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});

it('stays unmeasured without an element or a width, and works without ResizeObserver', () => {
  vi.stubGlobal('ResizeObserver', undefined);
  const hidden = render(<Probe width={500} show={false} />);
  expect(hidden.getByTestId('tier').textContent).toBe('none');
  hidden.unmount();
  const zero = render(<Probe width={0} />);
  expect(zero.getByTestId('tier').textContent).toBe('none');
  zero.unmount();
  const narrow = render(<Probe width={300} />);
  expect(narrow.getByTestId('tier').textContent).toBe('0');
});
