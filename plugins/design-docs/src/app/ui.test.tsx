// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Sparkles, CheckCheck } from 'lucide-react';
import { actionIcon, ActorLabel, ConfirmDialog, ContextMenu, contextMenuPoint, Dialog, EmptyState, FileIcon, IconButton, MenuItem, Popover, StatusPill } from './ui.js';

afterEach(cleanup);

it('dismisses open menus only outside their boundary or on Escape, using the current callback', () => {
  const first = vi.fn(), latest = vi.fn();
  const view = render(<Popover open onClose={first} anchor={<button>Menu anchor</button>}><button>Inside</button></Popover>);
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Inside' }));
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Menu anchor' }));
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(first).not.toHaveBeenCalled();
  view.rerender(<Popover open onClose={latest} anchor={<button>Menu anchor</button>} align="start"><button>Inside</button></Popover>);
  fireEvent.mouseDown(document.body);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(2);
  view.rerender(<Popover open={false} onClose={latest} anchor={<button>Menu anchor</button>}>Closed</Popover>);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.mouseDown(document.body);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(latest).toHaveBeenCalledTimes(2);
  view.unmount();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(latest).toHaveBeenCalledTimes(2);
});

it('portals dialogs and context menus to document.body so a transformed panel cannot clip them', () => {
  const { container } = render(
    <div style={{ transform: 'translateZ(0)' }}>
      <Dialog title="Portalled" onClose={() => undefined}>Body</Dialog>
      <ContextMenu at={{ x: 4, y: 4 }} label="Portalled menu" onClose={() => undefined}><MenuItem label="Item" onSelect={() => undefined} /></ContextMenu>
    </div>
  );
  const backdrop = screen.getByRole('dialog', { name: 'Portalled' }).parentElement!;
  expect(backdrop.classList.contains('dd-dialog-backdrop')).toBe(true);
  expect(backdrop.parentElement).toBe(document.body);
  expect(container.contains(backdrop)).toBe(false);
  const menu = screen.getByRole('menu', { name: 'Portalled menu' });
  expect(menu.parentElement).toBe(document.body);
  expect(container.contains(menu)).toBe(false);
});

it('closes dialogs through their controls, Escape or backdrop while retaining interior clicks', () => {
  const close = vi.fn();
  const view = render(<Dialog title="Review" onClose={close} wide footer={<span>Footer</span>}><button>Interior</button></Dialog>);
  expect(screen.getByRole('dialog', { name: 'Review' }).classList.contains('dd-dialog-wide')).toBe(true);
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Interior' }));
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(3);
  view.rerender(<Dialog title="Review" onClose={close}>Plain</Dialog>);
  expect(document.querySelector('.dd-dialog-footer')).toBeNull();
  expect(screen.getByRole('dialog').classList.contains('dd-dialog-wide')).toBe(false);
  view.unmount();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(3);
});

it.each([false, true])('allows cancellation and waits for confirmation before closing, danger=%s', async danger => {
  let finish!: () => void;
  const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const close = vi.fn();
  render(<ConfirmDialog request={{ title: 'Confirm action', body: 'Selected document', confirmLabel: 'Proceed', danger, run }} onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledOnce();
  expect(run).not.toHaveBeenCalled();
  close.mockClear();
  const confirm = screen.getByRole('button', { name: 'Proceed' });
  expect(confirm.classList.contains('dd-btn-danger')).toBe(danger);
  fireEvent.click(confirm);
  expect(confirm.hasAttribute('disabled')).toBe(true);
  fireEvent.click(confirm);
  expect(run).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  expect(close).toHaveBeenCalledOnce();
  expect(confirm.hasAttribute('disabled')).toBe(false);
});

it('renders menu hints, selection and disabled action controls', () => {
  const select = vi.fn(), click = vi.fn();
  const view = render(<><MenuItem label="Archive" hint="Keep history" icon={Sparkles} danger checked onSelect={select} />
    <IconButton label="Edit" icon={Sparkles} onClick={click} active danger disabled /></>);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Archive Keep history' }));
  expect(select).toHaveBeenCalledOnce();
  expect(screen.getByRole('menuitem').classList.contains('dd-menu-checked')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(click).not.toHaveBeenCalled();
  view.rerender(<><MenuItem label="Open" onSelect={select} /><IconButton label="Edit" icon={Sparkles} onClick={click} /></>);
  expect(document.querySelector('.dd-menu-hint')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(click).toHaveBeenCalledOnce();
});

it('keeps file kinds, actors and statuses recognizable with empty-state guidance', () => {
  expect(actionIcon('CheckCheck')).toBe(CheckCheck);
  expect(actionIcon('UnknownAction')).toBe(Sparkles);
  const view = render(<><FileIcon kind="image" /><FileIcon kind="svg" /><FileIcon kind="text" />
    <FileIcon kind="markdown" /><FileIcon kind="html" />
    <ActorLabel actor={{ kind: 'agent', label: 'Reviewer', threadId: 'review-thread' }} /><ActorLabel actor={{ kind: 'user', label: 'You', threadId: null }} />
    <StatusPill status="draft" compact /><EmptyState icon={Sparkles} title="No docs">Create a document</EmptyState></>);
  expect(screen.getByTitle('Agent · Reviewer')).toBeTruthy();
  expect(screen.getByTitle('You')).toBeTruthy();
  expect(document.querySelectorAll('.dd-file-icon')).toHaveLength(5);
  expect(document.querySelector('.dd-status-compact')).not.toBeNull();
  expect(screen.getByText('Create a document')).toBeTruthy();
  view.rerender(<><StatusPill status="draft" /><EmptyState icon={Sparkles} title="No docs" /></>);
  expect(document.querySelector('.dd-status-compact')).toBeNull();
  expect(document.querySelector('.dd-empty-body')).toBeNull();
});

it('opens a context menu at the pointer, or under the element from the keyboard', () => {
  const target = document.createElement('button');
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: 20, bottom: 90 } as DOMRect);
  expect(contextMenuPoint({ clientX: 5, clientY: 0, currentTarget: target })).toEqual({ x: 5, y: 0 });
  expect(contextMenuPoint({ clientX: 0, clientY: 0, currentTarget: target })).toEqual({ x: 32, y: 90 });
});

it('keeps a context menu in the window, moves with the keys, and gives focus back', () => {
  const close = vi.fn();
  const row = document.createElement('button');
  document.body.append(row);
  row.focus();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 120 } as DOMRect);
  const items = (
    <>
      <MenuItem label="One" onSelect={() => undefined} />
      <MenuItem label="Two" onSelect={() => undefined} />
      <MenuItem label="Three" onSelect={() => undefined} />
    </>
  );
  const view = render(<ContextMenu at={{ x: window.innerWidth - 10, y: window.innerHeight - 10 }} label="Actions" onClose={close}>{items}</ContextMenu>);
  const menu = screen.getByRole('menu', { name: 'Actions' });
  expect(menu.style.left).toBe(`${window.innerWidth - 204}px`);
  expect(menu.style.top).toBe(`${window.innerHeight - 124}px`);
  const [one, two, three] = screen.getAllByRole('menuitem');
  expect(document.activeElement).toBe(one);
  fireEvent.keyDown(menu, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(three);
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(one);
  fireEvent.keyDown(menu, { key: 'End' });
  expect(document.activeElement).toBe(three);
  fireEvent.keyDown(menu, { key: 'Home' });
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(two);
  fireEvent.keyDown(menu, { key: 'a' });
  expect(document.activeElement).toBe(two);
  expect(fireEvent.contextMenu(menu)).toBe(false);

  // Scrolling inside the menu keeps it; scrolling the page, resizing, blur and Tab close it.
  fireEvent.scroll(menu);
  expect(close).not.toHaveBeenCalled();
  fireEvent.scroll(window);
  fireEvent.resize(window);
  fireEvent.blur(window);
  fireEvent.keyDown(menu, { key: 'Tab' });
  expect(close).toHaveBeenCalledTimes(4);

  view.unmount();
  expect(document.activeElement).toBe(row);
  row.remove();
  vi.restoreAllMocks();
});

it('opens a context menu near the top left as asked, and leaves focus that moved elsewhere', () => {
  const elsewhere = document.createElement('input');
  document.body.append(elsewhere);
  const view = render(<ContextMenu at={{ x: 1, y: 2 }} label="Empty" onClose={() => undefined}>{null}</ContextMenu>);
  const menu = screen.getByRole('menu', { name: 'Empty' });
  expect([menu.style.left, menu.style.top]).toEqual(['4px', '4px']);
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  elsewhere.focus();
  view.unmount();
  expect(document.activeElement).toBe(elsewhere);
  elsewhere.remove();
});
