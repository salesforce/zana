/** @vitest-environment happy-dom */
import { useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ResizeHandle, usePaneSize, useStudioSplit } from './StudioResize.js';
import { BottomPanel } from './BottomPanel.js';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Handle({ horizontal = false, onCommit = vi.fn() }: { horizontal?: boolean; onCommit?(value: number): void }) {
  const [value, setValue] = useState(50);
  return <ResizeHandle label="Size" value={value} min={20} max={80} step={5} orientation={horizontal ? 'horizontal' : 'vertical'}
    onChange={setValue} onCommit={onCommit} onReset={() => setValue(50)} />;
}

it('sizes with the appropriate keyboard axis, bounds and resets without stealing unrelated keys', () => {
  const { rerender } = render(<Handle />);
  const handle = screen.getByRole('separator');
  const value = () => handle.getAttribute('aria-valuenow');
  fireEvent.keyDown(handle, { key: 'ArrowLeft' }); expect(value()).toBe('45');
  fireEvent.keyDown(handle, { key: 'ArrowRight' }); expect(value()).toBe('50');
  fireEvent.keyDown(handle, { key: 'Home' }); expect(value()).toBe('20');
  fireEvent.keyDown(handle, { key: 'ArrowLeft' }); expect(value()).toBe('20');
  fireEvent.keyDown(handle, { key: 'End' }); expect(value()).toBe('80');
  fireEvent.keyDown(handle, { key: 'ArrowRight' }); expect(value()).toBe('80');
  fireEvent.keyDown(handle, { key: 'Tab' }); expect(value()).toBe('80');
  fireEvent.keyDown(handle, { key: 'ArrowDown' }); expect(value()).toBe('80');
  fireEvent.keyDown(handle, { key: 'Enter' }); expect(value()).toBe('50');
  fireEvent.keyDown(handle, { key: 'Home' });
  fireEvent.keyDown(handle, { key: ' ' }); expect(value()).toBe('50');
  fireEvent.keyDown(handle, { key: 'End' });
  fireEvent.doubleClick(handle); expect(value()).toBe('50');
  rerender(<Handle horizontal />);
  fireEvent.keyDown(handle, { key: 'ArrowUp' }); expect(value()).toBe('45');
  fireEvent.keyDown(handle, { key: 'ArrowDown' }); expect(value()).toBe('50');
});

it('does not jump on grab, ignores extra pointers and commits once on release, cancel or blur', () => {
  const onCommit = vi.fn();
  const { unmount } = render(<Handle onCommit={onCommit} />);
  const handle = screen.getByRole('separator');
  handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = () => true; handle.releasePointerCapture = vi.fn();
  const down = (pointerId = 1) => fireEvent.pointerDown(handle, { button: 0, pointerId, clientX: 500 });
  fireEvent.pointerDown(handle, { button: 2, pointerId: 1 });
  expect(handle.setPointerCapture).not.toHaveBeenCalled();
  down(); expect(handle.getAttribute('aria-valuenow')).toBe('50');
  expect(document.activeElement).toBe(handle);
  down(2);
  fireEvent.pointerMove(handle, { pointerId: 2, clientX: 999 });
  fireEvent.pointerUp(handle, { pointerId: 2 }); expect(onCommit).not.toHaveBeenCalled();
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 510 });
  expect(handle.getAttribute('aria-valuenow')).toBe('60');
  fireEvent.pointerUp(handle, { pointerId: 1 }); expect(onCommit).toHaveBeenLastCalledWith(60);
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 540 });
  expect(handle.getAttribute('aria-valuenow')).toBe('60');
  expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
  down(); fireEvent.pointerCancel(handle, { pointerId: 1 });
  down(); fireEvent.lostPointerCapture(handle, { pointerId: 1 });
  down(); fireEvent(window, new Event('blur'));
  expect(onCommit).toHaveBeenCalledTimes(4);
  expect(handle.dataset.resizing).toBe('false');
  down(); unmount(); fireEvent(window, new Event('blur'));
  expect(onCommit).toHaveBeenCalledTimes(4);
});

it('stops a drag when its orientation changes', () => {
  const { rerender } = render(<Handle />);
  const handle = screen.getByRole('separator');
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 500 });
  rerender(<Handle horizontal />);
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 900 });
  expect(handle.dataset.resizing).toBe('false');
  expect(handle.getAttribute('aria-valuenow')).toBe('50');
});

it('restores only finite numeric sizes, saves on commit, isolates scopes and tolerates unavailable storage', () => {
  localStorage.setItem('one', '65'); localStorage.setItem('two', '30');
  const { result, rerender } = renderHook(({ key }) => usePaneSize(key, 50, 20, 80), { initialProps: { key: 'one' } });
  expect(result.current.size).toBe(65);
  act(() => result.current.onChange(70)); expect(localStorage.getItem('one')).toBe('65');
  act(() => result.current.onCommit(200)); expect(localStorage.getItem('one')).toBe('80');
  rerender({ key: 'two' }); expect(result.current.size).toBe(30);
  rerender({ key: 'missing' }); expect(result.current.size).toBe(50);
  localStorage.setItem('bad', '{'); rerender({ key: 'bad' }); expect(result.current.size).toBe(50);
  localStorage.setItem('string', '"70"'); rerender({ key: 'string' }); expect(result.current.size).toBe(50);
  act(() => result.current.onReset()); expect(result.current.size).toBe(50);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('Unavailable'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Unavailable'); });
  rerender({ key: 'blocked' }); expect(result.current.size).toBe(50);
  act(() => result.current.onCommit(60)); expect(result.current.size).toBe(60);
});

function Split({ stack = true, show = true }: { stack?: boolean; show?: boolean }) {
  const split = useStudioSplit({ storageKey: 'test-split', initial: 48, stack });
  return show ? <div ref={split.ref} data-testid="split" style={split.style}>{split.divider('Conversation and evidence')}</div> : null;
}

it('measures a lazily mounted split, adapts its orientation and minimums, and remembers each layout independently', () => {
  let width = 1000, height = 600;
  const observers: Array<() => void> = [];
  const disconnect = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height }) as DOMRect);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { observers.push(callback); } observe() {} disconnect = disconnect; });
  const { rerender, unmount } = render(<Split show={false} />);
  rerender(<Split />);
  let handle = screen.getByRole('separator');
  expect(handle.getAttribute('aria-orientation')).toBe('vertical');
  fireEvent.keyDown(handle, { key: 'ArrowRight' }); expect(handle.getAttribute('aria-valuenow')).toBe('52');
  expect(localStorage.getItem('test-split:columns')).toBe('52');
  width = 500; act(() => observers.forEach(callback => callback()));
  handle = screen.getByRole('separator');
  expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
  expect(handle.getAttribute('aria-valuenow')).toBe('58');
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 200 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 260 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(Number(handle.getAttribute('aria-valuenow'))).toBeGreaterThan(48);
  width = 1000; act(() => observers.forEach(callback => callback()));
  expect(handle.getAttribute('aria-valuenow')).toBe('52');
  width = 500; rerender(<Split stack={false} />); act(() => observers.forEach(callback => callback()));
  expect(screen.queryByRole('separator')).toBeNull();
  unmount(); expect(disconnect).toHaveBeenCalled();
});

it('still works without ResizeObserver and handles a zero-size hidden container', () => {
  vi.stubGlobal('ResizeObserver', undefined);
  render(<Split />);
  const handle = screen.getByRole('separator');
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 });
  expect(handle.getAttribute('aria-valuenow')).toBe('48');
});

it('resizes the bottom panel upward, preserves child state when collapsed and protects editor space after a parent resize', () => {
  let height = 800;
  let resized = () => {};
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 1000, height }) as DOMRect);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} });
  const p = { active: 'problems' as const, problems: 0, onSelect: vi.fn(), onToggle: vi.fn(), render: () => <input defaultValue="retained" />, storageKey: 'bottom' };
  const { rerender, container } = render(<div><BottomPanel {...p} open /></div>);
  const handle = screen.getByRole('separator');
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 300 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 240 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(handle.getAttribute('aria-valuenow')).toBe('280');
  expect(localStorage.getItem('bottom')).toBe('280');
  fireEvent.keyDown(handle, { key: 'ArrowUp' }); expect(handle.getAttribute('aria-valuenow')).toBe('304');
  fireEvent.keyDown(handle, { key: 'ArrowDown' }); expect(handle.getAttribute('aria-valuenow')).toBe('280');
  height = 300; act(() => resized());
  expect(handle.getAttribute('aria-valuemax')).toBe('100');
  expect(container.querySelector<HTMLElement>('.sf-bottom-body')!.style.height).toBe('100px');
  rerender(<div><BottomPanel {...p} open={false} /></div>);
  expect(screen.queryByRole('separator')).toBeNull();
  expect(container.querySelector('input')!.value).toBe('retained');
});
