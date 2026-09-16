/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SplitDivider } from './SplitDivider.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.body.style.cssText = ''; });
function setup(dir: 'row' | 'col' = 'row', hidden = false) {
  const onResize = vi.fn();
  const result = render(<div>
    <div data-testid="before" style={{ flex: '0.5 1 0px' }} />
    <SplitDivider dir={dir} hidden={hidden} fraction={0.5} onResize={onResize} />
    <div data-testid="after" style={{ flex: '0.5 1 0px' }} />
  </div>);
  const divider = result.container.querySelector('[role="separator"]') as HTMLDivElement;
  const before = screen.getByTestId('before');
  const after = screen.getByTestId('after');
  vi.spyOn(before, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 300));
  vi.spyOn(after, 'getBoundingClientRect').mockReturnValue(new DOMRect(401, 301, 400, 300));
  Object.assign(divider, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  const down = () => fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
  const move = (pointerId = 1) => fireEvent.pointerMove(divider, { pointerId, clientX: 560, clientY: 420 });
  const up = (pointerId = 1) => fireEvent.pointerUp(divider, { pointerId });
  return { ...result, divider, before, after, onResize, down, move, up };
}

describe('SplitDivider', () => {
  it.each(['row', 'col'] as const)('supports %s keyboard resizing, limits and balance', (dir) => {
    const { divider, onResize } = setup(dir);
    expect(divider.tabIndex).toBe(0);
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    expect(divider.getAttribute('aria-orientation')).toBe(dir === 'row' ? 'vertical' : 'horizontal');
    fireEvent.keyDown(divider, { key: dir === 'row' ? 'ArrowRight' : 'ArrowDown' });
    expect(onResize).toHaveBeenLastCalledWith(0.52);
    fireEvent.keyDown(divider, { key: dir === 'row' ? 'ArrowLeft' : 'ArrowUp', shiftKey: true });
    expect(onResize).toHaveBeenLastCalledWith(0.4);
    fireEvent.keyDown(divider, { key: 'Home' });
    expect(onResize).toHaveBeenLastCalledWith(0.15);
    fireEvent.keyDown(divider, { key: 'End' });
    expect(onResize).toHaveBeenLastCalledWith(0.85);
    fireEvent.keyDown(divider, { key: 'Enter' });
    expect(onResize).toHaveBeenLastCalledWith(0.5);
    fireEvent.doubleClick(divider);
    expect(onResize).toHaveBeenCalledTimes(6);
    fireEvent.keyDown(divider, { key: 'Tab' });
    fireEvent.keyDown(divider, { key: 'Home', metaKey: true });
    expect(onResize).toHaveBeenCalledTimes(6);
  });

  it.each(['row', 'col'] as const)('previews %s resizing without persistence until release', (dir) => {
    const { divider, before, onResize, down, move, up } = setup(dir);
    down();
    move(2);
    expect(before.style.flexGrow).toBe('0.5');
    move();
    expect(before.style.flexGrow).toBe('0.7');
    expect(onResize).not.toHaveBeenCalled();
    expect(divider.getAttribute('aria-valuenow')).toBe('70');
    up(2);
    expect(onResize).not.toHaveBeenCalled();
    up();
    expect(onResize).toHaveBeenCalledExactlyOnceWith(0.7);
    expect(document.body.style.cursor).toBe('');
    expect(divider.hasAttribute('data-dragging')).toBe(false);
  });

  it.each(['Escape', 'blur', 'resize', 'pointercancel', 'lostpointercapture', 'unmount'])('rolls back on %s', (reason) => {
    const { divider, before, onResize, down, move, up, unmount } = setup();
    document.body.style.cursor = 'crosshair';
    down(); move();
    if (reason === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (reason === 'blur' || reason === 'resize') fireEvent(window, new Event(reason));
    else if (reason === 'unmount') unmount();
    else fireEvent(divider, new PointerEvent(reason, { pointerId: 1 }));
    up();
    expect(onResize).not.toHaveBeenCalled();
    expect(before.style.flexGrow).toBe('0.5');
    expect(document.body.style.cursor).toBe('crosshair');
  });

  it('keeps resizing through parent rerenders and commits with the current callback', () => {
    const { divider, before, onResize, down, move, up, rerender } = setup();
    down();
    move();
    const updatedResize = vi.fn();
    rerender(<div>
      <div data-testid="before" style={{ flex: '0.5 1 0px' }} />
      <SplitDivider dir="row" hidden={false} fraction={0.5} onResize={updatedResize} />
      <div data-testid="after" style={{ flex: '0.5 1 0px' }} />
    </div>);
    expect(divider.dataset.dragging).toBe('true');
    expect(before.style.flexGrow).toBe('0.7');
    up();
    expect(updatedResize).toHaveBeenCalledExactlyOnceWith(0.7);
    expect(onResize).not.toHaveBeenCalled();
  });

  it('ignores right-clicks, unrelated keys/cancels and commits no movement', () => {
    const { divider, onResize, down, up } = setup();
    fireEvent.pointerDown(divider, { button: 2 });
    expect(divider.hasAttribute('data-dragging')).toBe(false);
    down();
    fireEvent.keyDown(window, { key: 'x' });
    fireEvent.pointerCancel(divider, { pointerId: 2 });
    expect(divider.dataset.dragging).toBe('true');
    up();
    expect(onResize).not.toHaveBeenCalled();
  });

  it('cannot resize when hidden or without measurable siblings', () => {
    const { divider, before, onResize, down } = setup('row', true);
    expect(divider.tabIndex).toBe(-1);
    down();
    fireEvent.keyDown(divider, { key: 'Home' });
    fireEvent.doubleClick(divider);
    expect(onResize).not.toHaveBeenCalled();
    cleanup();
    const visible = setup();
    vi.mocked(visible.before.getBoundingClientRect).mockReturnValue(new DOMRect());
    vi.mocked(visible.after.getBoundingClientRect).mockReturnValue(new DOMRect());
    visible.down();
    expect(visible.divider.hasAttribute('data-dragging')).toBe(false);
    visible.before.remove();
    visible.down();
    expect(visible.onResize).not.toHaveBeenCalled();
  });
});
