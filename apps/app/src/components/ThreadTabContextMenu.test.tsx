// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThreadTabContextMenu } from './ThreadTabContextMenu.js';

afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function setup() {
  const anchor = document.createElement('button'); document.body.append(anchor);
  const onClose = vi.fn(), run = vi.fn();
  const items = [{ label: 'Copy', run }, { label: 'Unavailable', run, disabled: true }, { label: 'Close', run, separatorBefore: true }];
  const view = render(<ThreadTabContextMenu x={3000} y={3000} anchor={anchor} items={items} onClose={onClose} />);
  return { anchor, onClose, run, view };
}

it('clamps to the viewport, skips disabled items, supports keyboard traversal and runs the selected action', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 252, height: 300 } as DOMRect);
  const { onClose, run, anchor } = setup();
  const menu = screen.getByRole('menu');
  expect(menu.parentElement).toBe(document.body);
  expect(menu.style.left).toBe(`${window.innerWidth - 260}px`);
  expect(menu.style.top).toBe(`${window.innerHeight - 308}px`);
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Copy' }));
  for (const [key, label] of [['ArrowUp', 'Close'], ['ArrowDown', 'Copy'], ['End', 'Close'], ['Home', 'Copy']]) {
    fireEvent.keyDown(document.activeElement!, { key });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: label }));
  }
  fireEvent.keyDown(menu, { key: 'a' }); expect(onClose).not.toHaveBeenCalled();
  fireEvent.contextMenu(menu); expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledOnce(); expect(run).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(anchor);
});

it.each(['Escape', 'Tab'])('dismisses and returns focus on %s', key => {
  const { anchor, onClose, run } = setup();
  fireEvent.keyDown(document.activeElement!, { key });
  expect(onClose).toHaveBeenCalledOnce(); expect(run).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(anchor);
});

it('dismisses on outside pointer/context menu, blur, resize and scrolling, cleaning up every listener', () => {
  const { onClose, view } = setup();
  const menu = screen.getByRole('menu');
  fireEvent.pointerDown(menu); fireEvent.scroll(menu); expect(onClose).not.toHaveBeenCalled();
  fireEvent.pointerDown(document.body); fireEvent.contextMenu(document.body); fireEvent.scroll(document); fireEvent.blur(window); fireEvent.resize(window);
  expect(onClose).toHaveBeenCalledTimes(5);
  view.unmount(); onClose.mockClear();
  fireEvent.pointerDown(document.body); fireEvent.contextMenu(document.body); fireEvent.scroll(document); fireEvent.blur(window); fireEvent.resize(window);
  expect(onClose).not.toHaveBeenCalled();
});

it('uses a gutter at the left and top edges and tolerates a removed anchor', () => {
  const anchor = document.createElement('button'); document.body.append(anchor);
  const onClose = vi.fn();
  render(<ThreadTabContextMenu x={-30} y={-30} anchor={anchor} items={[{ label: 'Close', run: vi.fn() }]} onClose={onClose} />);
  const menu = screen.getByRole('menu'); expect(menu.style.left).toBe('8px'); expect(menu.style.top).toBe('8px');
  anchor.remove(); fireEvent.keyDown(menu, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
});

it('keeps measured coordinates on rerender and reclamps when another tab opens the menu', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 252, height: 300 } as DOMRect);
  const { anchor, view, onClose } = setup();
  const items = [{ label: 'Copy', run: vi.fn() }];
  view.rerender(<ThreadTabContextMenu x={3000} y={3000} anchor={anchor} items={items} onClose={onClose} />);
  expect(screen.getByRole('menu').style.top).toBe(`${window.innerHeight - 308}px`);
  view.rerender(<ThreadTabContextMenu x={10} y={20} anchor={anchor} items={items} onClose={onClose} />);
  expect(screen.getByRole('menu').style.left).toBe('10px');
  expect(screen.getByRole('menu').style.top).toBe('20px');
});

it('stays open during automatic conversation scrolling but dismisses when the tab strip moves', () => {
  const { anchor, onClose } = setup();
  const conversation = document.createElement('div'); document.body.append(conversation);
  fireEvent.scroll(conversation);
  expect(onClose).not.toHaveBeenCalled();
  const strip = document.createElement('div'); document.body.append(strip); strip.append(anchor);
  fireEvent.scroll(strip);
  expect(onClose).toHaveBeenCalledOnce();
});
