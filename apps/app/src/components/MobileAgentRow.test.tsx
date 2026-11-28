// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileAgentRow } from './MobileAgentRow';
import type { MobileAgentItem } from './mobile-agent-items';

const h = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../store', () => ({ pushErrorToast: h.toast, errorMessage: (error: Error) => error.message }));
const item: MobileAgentItem = {
  key: 'thread:t', kind: 'thread', id: 't', projectId: 'p', title: 'Review changes',
  projectName: 'Project', to: '/threads/t', status: 'Working', createdAt: 1
};

function mount(onClose = vi.fn().mockResolvedValue(undefined)) {
  const onOpen = vi.fn();
  render(<MemoryRouter><ul><MobileAgentRow item={item} active onOpen={onOpen} onClose={onClose} /></ul></MemoryRouter>);
  const row = screen.getByRole('link');
  let captured = false;
  row.setPointerCapture = vi.fn(() => { captured = true; });
  row.hasPointerCapture = vi.fn(() => captured);
  row.releasePointerCapture = vi.fn(() => { captured = false; });
  const pointer = (type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel' | 'lostPointerCapture', x: number, y = 30, extra = {}) => {
    fireEvent[type](row, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, ...extra });
  };
  return { row, pointer, onClose, onOpen };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it.each([
  ['Idle', true, false, 'Unread'],
  ['Idle', true, true, 'Idle'],
  ['Idle', false, false, 'Idle'],
  ['Working', true, false, 'Working'],
  ['Needs you', true, false, 'Needs you'],
  ['Error', true, false, 'Error']
] as const)('shows %s with unread=%s and active=%s as %s', (status, unread, active, expected) => {
  render(<MemoryRouter><ul><MobileAgentRow item={{ ...item, status, unread }} active={active}
    onOpen={vi.fn()} onClose={vi.fn()} /></ul></MemoryRouter>);
  const row = screen.getByRole('link', { name: new RegExp(expected) });
  expect(row.dataset.rowStatus).toBe(expected);
  const indicator = row.querySelector('.mobile-agent-status')!;
  expect(indicator.textContent).toBe(expected);
  expect(indicator.classList.contains('sr-only')).toBe(expected === 'Idle');
});

it('follows a long left swipe, closes on release and suppresses the resulting link click', async () => {
  const { row, pointer, onClose, onOpen } = mount();
  pointer('pointerDown', 220);
  pointer('pointerMove', 50);
  expect(row.parentElement!.style.transform).toBe('translateX(-170px)');
  expect(row.closest('li')!.dataset.ready).toBe('true');
  expect(row.setPointerCapture).toHaveBeenCalledWith(1);
  expect(onClose).not.toHaveBeenCalled();
  pointer('pointerUp', 50);
  fireEvent.click(row);
  expect(onOpen).not.toHaveBeenCalled();
  expect(row.releasePointerCapture).toHaveBeenCalledWith(1);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(row.parentElement!.style.transform).toBe('translateX(0px)');
});

it('reveals a tappable close action after a short left swipe', async () => {
  const { row, pointer, onClose, onOpen } = mount();
  pointer('pointerDown', 220);
  pointer('pointerMove', 150);
  pointer('pointerUp', 150);
  fireEvent.click(row);
  expect(onClose).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();
  expect(row.parentElement!.style.transform).toBe('translateX(-88px)');
  expect(row.closest('li')!.dataset.swiping).toBe('false');
  const action = row.closest('li')!.querySelector('.mobile-agent-swipe-action button')!;
  expect(action.getAttribute('aria-hidden')).toBe('false');
  expect(action.getAttribute('tabindex')).toBe('0');
  fireEvent.click(action);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it.each(['tap', 'outside', 'escape', 'swipe back'])('dismisses the revealed action with %s without navigating or closing', (type) => {
  const { row, pointer, onClose, onOpen } = mount();
  pointer('pointerDown', 220);
  pointer('pointerMove', 150);
  pointer('pointerUp', 150);
  fireEvent.click(row); // synthetic post-drag click
  if (type === 'tap') {
    pointer('pointerDown', 150);
    pointer('pointerUp', 150);
    fireEvent.click(row);
  }
  if (type === 'outside') fireEvent.pointerDown(document.body);
  if (type === 'escape') {
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(row.parentElement!.style.transform).toBe('translateX(-88px)');
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(document.activeElement).toBe(row);
  }
  if (type === 'swipe back') {
    pointer('pointerDown', 150);
    pointer('pointerMove', 230);
    pointer('pointerUp', 230);
    fireEvent.click(row);
  }
  expect(row.parentElement!.style.transform).toBe('translateX(0px)');
  expect(onClose).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();
});

it('keeps the action open when interacting within the row and cleans up its outside listener', () => {
  const remove = vi.spyOn(document, 'removeEventListener');
  const { row, pointer } = mount();
  pointer('pointerDown', 220);
  pointer('pointerMove', 150);
  pointer('pointerUp', 150);
  fireEvent.pointerDown(row);
  expect(row.parentElement!.style.transform).toBe('translateX(-88px)');
  cleanup();
  expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function));
  remove.mockRestore();
});

it.each([
  ['small drag', 190, 30], ['right swipe', 390, 30], ['scroll', 230, 160], ['diagonal', 50, 170]
])('does not close or reveal on a %s', (_label, x, y) => {
  const { row, pointer, onClose } = mount();
  pointer('pointerDown', 220);
  pointer('pointerMove', x as number, y as number);
  pointer('pointerUp', x as number, y as number);
  expect(onClose).not.toHaveBeenCalled();
  expect(row.parentElement!.style.transform).toBe('translateX(0px)');
});

it.each(['pointerCancel', 'lostPointerCapture'] as const)('resets a swipe on %s without closing or following the link', (type) => {
  const { row, pointer, onClose, onOpen } = mount();
  pointer('pointerDown', 220);
  pointer('pointerMove', 50);
  pointer(type, 50);
  pointer('pointerUp', 50);
  fireEvent.click(row);
  expect(onClose).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();
  expect(row.parentElement!.style.transform).toBe('translateX(0px)');
});

it('restores an already revealed action when a second drag is cancelled', () => {
  const { row, pointer, onClose } = mount();
  pointer('pointerDown', 220);
  pointer('pointerMove', 150);
  pointer('pointerUp', 150);
  pointer('pointerDown', 150);
  pointer('pointerMove', 50);
  pointer('pointerCancel', 50);
  expect(row.parentElement!.style.transform).toBe('translateX(-88px)');
  expect(onClose).not.toHaveBeenCalled();
});

it('keeps swiping when implicit touch capture transfers from a child to the link', () => {
  const { row, pointer, onClose } = mount();
  pointer('pointerDown', 220);
  pointer('pointerMove', 200);
  fireEvent.lostPointerCapture(row.querySelector('.mobile-agent-status')!, { pointerId: 1 });
  pointer('pointerMove', 50);
  pointer('pointerUp', 50);
  expect(onClose).toHaveBeenCalledOnce();
});

it('supports taps with slight jitter, including after an aborted swipe', () => {
  const { row, pointer, onClose, onOpen } = mount();
  pointer('pointerDown', 220);
  pointer('pointerMove', 190);
  pointer('pointerUp', 190);
  pointer('pointerDown', 220);
  pointer('pointerMove', 216);
  pointer('pointerUp', 216);
  fireEvent.click(row);
  expect(onOpen).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
});

it('ignores other pointers and secondary mouse buttons', () => {
  const { row, pointer, onClose } = mount();
  pointer('pointerDown', 220, 30, { isPrimary: false });
  pointer('pointerMove', 50);
  pointer('pointerUp', 50);
  pointer('pointerDown', 220, 30, { button: 2 });
  pointer('pointerMove', 50);
  pointer('pointerUp', 50);
  pointer('pointerDown', 220);
  pointer('pointerMove', 50, 30, { pointerId: 2 });
  pointer('pointerUp', 50, 30, { pointerId: 2 });
  expect(onClose).not.toHaveBeenCalled();
  expect(row.parentElement!.style.transform).toBe('translateX(0px)');
});

it('caps the visual drag and allows reversing it before release', () => {
  const { row, pointer, onClose } = mount();
  pointer('pointerDown', 420);
  pointer('pointerMove', 20);
  expect(row.parentElement!.style.transform).toBe('translateX(-220px)');
  pointer('pointerMove', 450);
  expect(row.parentElement!.style.transform).toBe('translateX(0px)');
  pointer('pointerUp', 450);
  expect(onClose).not.toHaveBeenCalled();
});

it('provides a close button and blocks repeated close attempts while pending', async () => {
  let resolve!: () => void;
  const onClose = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
  const { row, pointer, onOpen } = mount(onClose);
  const button = screen.getByRole('button', { name: 'Close Review changes' }) as HTMLButtonElement;
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  expect(row.closest('li')!.getAttribute('aria-busy')).toBe('true');
  fireEvent.click(button);
  pointer('pointerDown', 220);
  pointer('pointerMove', 50);
  pointer('pointerUp', 50);
  fireEvent.click(row);
  expect(onClose).toHaveBeenCalledOnce();
  expect(onOpen).not.toHaveBeenCalled();
  resolve();
  await waitFor(() => expect(button.disabled).toBe(false));
});

it('reports a failed close and allows retry', async () => {
  const onClose = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(undefined);
  mount(onClose);
  const button = screen.getByRole('button', { name: 'Close Review changes' }) as HTMLButtonElement;
  fireEvent.click(button);
  await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Connection lost'));
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
});
