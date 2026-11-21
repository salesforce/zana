// @vitest-environment happy-dom
import { useRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASIC_PANEL_SPLIT_MIN_WIDTH, useBasicPanelLayout } from './useBasicPanelLayout.js';

let width = 1200;
let notify: ResizeObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();
function Fixture({ basic = true, hosted = false, absent = false }: { basic?: boolean; hosted?: boolean; absent?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const compact = useBasicPanelLayout(ref, basic);
  const content = <>{absent ? null : <div ref={ref} data-testid="view" />}<output>{String(compact)}</output></>;
  return hosted ? <div className="split-workspace-host" data-testid="host">{content}</div> : content;
}
beforeEach(() => {
  width = 1200;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width }) as DOMRect);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { notify = callback; }
    observe = observe;
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function resize(value: number) { width = value; act(() => notify([], {} as ResizeObserver)); }

describe('Basic pane width', () => {
  it('uses the actual allocated pane and keeps its last meaningful width while hidden', () => {
    render(<Fixture />);
    expect(observe).toHaveBeenCalledWith(screen.getByTestId('view'));
    expect(screen.getByRole('status').textContent).toBe('false');
    resize(BASIC_PANEL_SPLIT_MIN_WIDTH - 1);
    expect(screen.getByRole('status').textContent).toBe('true');
    resize(0);
    expect(screen.getByRole('status').textContent).toBe('true');
    resize(BASIC_PANEL_SPLIT_MIN_WIDTH);
    expect(screen.getByRole('status').textContent).toBe('false');
  });
  it('measures the shared split host and disconnects when Advanced resumes', () => {
    width = 800;
    const view = render(<Fixture hosted />);
    expect(observe).toHaveBeenCalledWith(screen.getByTestId('host'));
    expect(screen.getByRole('status').textContent).toBe('true');
    view.rerender(<Fixture hosted basic={false} />);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toBe('false');
    view.rerender(<Fixture hosted />);
    expect(screen.getByRole('status').textContent).toBe('true');
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });
  it('does not subscribe for an absent view or Advanced', () => {
    const view = render(<Fixture absent />);
    expect(observe).not.toHaveBeenCalled();
    view.rerender(<Fixture basic={false} />);
    expect(observe).not.toHaveBeenCalled();
  });
  it('falls back to a removable resize listener when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = render(<Fixture />);
    width = 600;
    act(() => window.dispatchEvent(new Event('resize')));
    expect(screen.getByRole('status').textContent).toBe('true');
    view.unmount();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
