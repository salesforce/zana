/** @vitest-environment happy-dom */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { layoutForTier, STUDIO_TIERS, useWidthTier } from './useWidthTier.js';

function Probe({ width, show = true }: { width: number; show?: boolean }) {
  const [ref, tier] = useWidthTier();
  return <div>
    <output data-testid="tier">{tier === null ? 'none' : String(tier)}</output>
    {show ? <div ref={el => { if (el) el.getBoundingClientRect = () => ({ width } as DOMRect); ref(el); }} /> : null}
  </div>;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('uses the Studio breakpoints and maps tiers to layouts', () => {
  expect(STUDIO_TIERS).toEqual([400, 620, 960]);
  expect(layoutForTier(null)).toBe('legacy');
  expect(layoutForTier(0)).toBe('compact');
  expect(layoutForTier(1)).toBe('compact');
  expect(layoutForTier(2)).toBe('wide');
  expect(layoutForTier(3)).toBe('wide');
});

it('measures before paint and follows resizes', () => {
  let notify: ResizeObserverCallback = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { notify = callback; } observe() {} disconnect = disconnect; });
  const view = render(<Probe width={500} />);
  expect(view.getByTestId('tier').textContent).toBe('1');
  act(() => notify([{ contentRect: { width: 300 } } as ResizeObserverEntry], {} as ResizeObserver));
  expect(view.getByTestId('tier').textContent).toBe('0');
  act(() => notify([{ contentRect: { width: 1000 } } as ResizeObserverEntry], {} as ResizeObserver));
  expect(view.getByTestId('tier').textContent).toBe('3');
  act(() => notify([], {} as ResizeObserver));
  expect(view.getByTestId('tier').textContent).toBe('none');
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});

it('stays unmeasured without an element or width, and works without ResizeObserver', () => {
  vi.stubGlobal('ResizeObserver', undefined);
  const hidden = render(<Probe width={500} show={false} />);
  expect(hidden.getByTestId('tier').textContent).toBe('none');
  hidden.unmount();
  const zero = render(<Probe width={0} />);
  expect(zero.getByTestId('tier').textContent).toBe('none');
  zero.unmount();
  const measured = render(<Probe width={700} />);
  expect(measured.getByTestId('tier').textContent).toBe('2');
});
