/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryEditorPane } from './QueryEditorPane.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('query editor resize', () => {
  it('supports bounded keyboard adjustments and reset', () => {
    render(<QueryEditorPane><textarea aria-label="Query" /></QueryEditorPane>);
    const divider = screen.getByRole('separator', { name: 'Resize query editor' });
    fireEvent.keyDown(divider, { key: 'ArrowDown' });
    expect(divider.getAttribute('aria-valuenow')).toBe('204');
    fireEvent.keyDown(divider, { key: 'ArrowUp' });
    expect(divider.getAttribute('aria-valuenow')).toBe('180');
    fireEvent.keyDown(divider, { key: 'Home' });
    expect(divider.getAttribute('aria-valuenow')).toBe('140');
    fireEvent.keyDown(divider, { key: 'End' });
    expect(divider.getAttribute('aria-valuenow')).toBe('520');
    fireEvent.keyDown(divider, { key: 'Enter' });
    expect(divider.getAttribute('aria-valuenow')).toBe('520');
    fireEvent.doubleClick(divider);
    expect(divider.getAttribute('aria-valuenow')).toBe('180');
  });
  it('captures a pointer and stops changing size on release or cancellation', () => {
    render(<QueryEditorPane>Query</QueryEditorPane>);
    const divider = screen.getByRole('separator');
    divider.setPointerCapture = vi.fn(); divider.releasePointerCapture = vi.fn(); divider.hasPointerCapture = () => true;
    fireEvent.pointerDown(divider, { button: 2, clientY: 100, pointerId: 1 });
    expect(divider.setPointerCapture).not.toHaveBeenCalled();
    fireEvent.pointerDown(divider, { button: 0, clientY: 100, pointerId: 1 });
    expect(document.activeElement).toBe(divider);
    fireEvent.pointerDown(divider, { button: 0, clientY: 500, pointerId: 2 });
    fireEvent.pointerMove(divider, { clientY: 800, pointerId: 2 });
    fireEvent.pointerUp(divider, { pointerId: 2 });
    expect(divider.getAttribute('aria-valuenow')).toBe('180');
    fireEvent.pointerMove(divider, { clientY: 180, pointerId: 1 });
    expect(divider.getAttribute('aria-valuenow')).toBe('260');
    fireEvent.pointerUp(divider, { pointerId: 1 });
    fireEvent.pointerMove(divider, { clientY: 400, pointerId: 1 });
    expect(divider.getAttribute('aria-valuenow')).toBe('260');
    fireEvent.pointerDown(divider, { button: 0, clientY: 100, pointerId: 1 });
    fireEvent.pointerCancel(divider, { pointerId: 1 });
    fireEvent.lostPointerCapture(divider, { pointerId: 1 });
    fireEvent.pointerMove(divider, { clientY: 400, pointerId: 1 });
    expect(divider.getAttribute('aria-valuenow')).toBe('260');
  });
  it('keeps results visible and updates the accessible range when the window shrinks', () => {
    const size = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
    let resized!: () => void;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const view = render(<QueryEditorPane>Query</QueryEditorPane>);
    const divider = screen.getByRole('separator');
    fireEvent.keyDown(divider, { key: 'End' });
    expect(divider.getAttribute('aria-valuemax')).toBe('325');
    expect(divider.getAttribute('aria-valuenow')).toBe('325');
    size.mockReturnValue(280);
    act(() => resized());
    expect(divider.getAttribute('aria-valuemax')).toBe('140');
    expect(divider.getAttribute('aria-valuenow')).toBe('140');
    fireEvent.doubleClick(divider);
    expect(divider.getAttribute('aria-valuenow')).toBe('140');
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
