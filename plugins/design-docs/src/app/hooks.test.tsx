// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useResource, useWidthTier } from './hooks.js';

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

function ResourceProbe({ id, keepPrevious, gate }: { id: string | null; keepPrevious: boolean; gate?: Promise<void> }) {
  const resource = useResource(id, async () => {
    if (id === 'b') await gate;
    return `data:${id}`;
  }, keepPrevious);
  return <output data-testid="resource">{`${resource.data ?? 'none'}|${resource.loading ? 'loading' : 'idle'}`}</output>;
}

async function reloadWhileGated(keepPrevious: boolean) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  const view = render(<ResourceProbe id="a" keepPrevious={keepPrevious} gate={gate} />);
  await act(async () => {});
  view.rerender(<ResourceProbe id="b" keepPrevious={keepPrevious} gate={gate} />);
  await act(async () => {});
  const during = view.getByTestId('resource').textContent;
  return { view, during, open, gate };
}

it("keeps the previous key's data while a keepPrevious resource reloads, and drops it when the key clears", async () => {
  const { view, during, open, gate } = await reloadWhileGated(true);
  expect(during).toBe('data:a|loading');
  open();
  await act(async () => { await gate; });
  expect(view.getByTestId('resource').textContent).toBe('data:b|idle');
  view.rerender(<ResourceProbe id={null} keepPrevious gate={gate} />);
  await act(async () => {});
  expect(view.getByTestId('resource').textContent).toBe('none|idle');
});

it("drops the previous key's data by default", async () => {
  const { during } = await reloadWhileGated(false);
  expect(during).toBe('none|loading');
});
