/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentforceStudioSplit } from './AgentforceStudioSplit.js';

afterEach(cleanup);
const props = { editor: <iframe title="Script" />, children: <aside>Conversation</aside>, open: true };

describe('Agentforce studio resizing', () => {
  it('supports keyboard sizing, bounds, reset and persistence between workflows', () => {
    const { rerender } = render(<AgentforceStudioSplit {...props} />);
    const divider = screen.getByRole('separator', { name: 'Resize editor and side panel' });
    expect(divider.getAttribute('aria-valuenow')).toBe('58');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider.getAttribute('aria-valuenow')).toBe('54');
    fireEvent.keyDown(divider, { key: 'Home' });
    expect(divider.getAttribute('aria-valuenow')).toBe('28');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider.getAttribute('aria-valuenow')).toBe('28');
    fireEvent.keyDown(divider, { key: 'End' });
    expect(divider.getAttribute('aria-valuenow')).toBe('72');
    fireEvent.keyDown(divider, { key: 'Tab' });
    expect(divider.getAttribute('aria-valuenow')).toBe('72');
    rerender(<AgentforceStudioSplit {...props} open={false} />);
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.getByTitle('Script')).toBeTruthy();
    rerender(<AgentforceStudioSplit {...props} />);
    const restored = screen.getByRole('separator');
    expect(restored.getAttribute('aria-valuenow')).toBe('72');
    fireEvent.doubleClick(restored);
    expect(restored.getAttribute('aria-valuenow')).toBe('58');
  });

  it('captures pointer drags across the iframe and clears capture on release or cancellation', () => {
    const { container, rerender } = render(<AgentforceStudioSplit {...props} />);
    const workspace = container.firstElementChild as HTMLElement;
    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 1000 } as DOMRect);
    const divider = screen.getByRole('separator');
    divider.setPointerCapture = vi.fn();
    divider.hasPointerCapture = vi.fn(() => true);
    divider.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(divider, { button: 2, pointerId: 7 });
    expect(divider.setPointerCapture).not.toHaveBeenCalled();
    fireEvent.pointerMove(divider, { pointerId: 7, clientX: 400 });
    expect(divider.getAttribute('aria-valuenow')).toBe('58');
    fireEvent.pointerDown(divider, { button: 0, pointerId: 7, clientX: 680 });
    expect(divider.setPointerCapture).toHaveBeenCalledWith(7);
    expect(divider.dataset.resizing).toBe('true');
    fireEvent.pointerMove(divider, { pointerId: 7, clientX: 420 });
    expect(divider.getAttribute('aria-valuenow')).toBe('32');
    fireEvent.pointerUp(divider, { pointerId: 8 });
    expect(divider.dataset.resizing).toBe('true');
    fireEvent.pointerUp(divider, { pointerId: 7 });
    expect(divider.dataset.resizing).toBe('false');
    expect(divider.releasePointerCapture).toHaveBeenCalledWith(7);
    fireEvent.pointerDown(divider, { button: 0, pointerId: 9 });
    fireEvent.pointerCancel(divider, { pointerId: 9 });
    expect(divider.dataset.resizing).toBe('false');
    divider.hasPointerCapture = () => false;
    fireEvent.pointerDown(divider, { button: 0, pointerId: 10 });
    fireEvent.lostPointerCapture(divider, { pointerId: 10 });
    expect(divider.dataset.resizing).toBe('false');
    fireEvent.pointerDown(divider, { button: 0, pointerId: 11 });
    rerender(<AgentforceStudioSplit {...props} open={false} />);
    expect(screen.queryByRole('separator')).toBeNull();
  });
});

it('keeps compact editor/panel views mounted and ignores a zero-width hidden split', () => {
  const { rerender, container } = render(<AgentforceStudioSplit {...props} mode="editor" />);
  expect(screen.queryByRole('separator')).toBeNull();
  expect(screen.getByTitle('Script')).toBeTruthy();
  rerender(<AgentforceStudioSplit {...props} mode="panel" />);
  expect(screen.queryByRole('separator')).toBeNull();
  rerender(<AgentforceStudioSplit {...props} />);
  vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue({ width: 0 } as DOMRect);
  const divider = screen.getByRole('separator');
  fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 100 });
  fireEvent.pointerMove(divider, { pointerId: 1, clientX: 800 });
  expect(divider.getAttribute('aria-valuenow')).toBe('58');
});

it('cancels an in-progress drag when switching layout storage scopes', () => {
  localStorage.clear();
  const { rerender } = render(<AgentforceStudioSplit {...props} storageKey="first-project" />);
  const oldHandle = screen.getByRole('separator');
  fireEvent.pointerDown(oldHandle, { button: 0, pointerId: 1, clientX: 100 });
  rerender(<AgentforceStudioSplit {...props} storageKey="second-project" />);
  expect(screen.getByRole('separator')).not.toBe(oldHandle);
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('58');
  expect(screen.getByRole('separator').dataset.resizing).toBe('false');
  fireEvent.pointerUp(oldHandle, { pointerId: 1 });
  expect(localStorage.getItem('second-project')).toBeNull();
});
