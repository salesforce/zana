/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  setFullScreen: vi.fn(),
  onFullScreenChanged: vi.fn(() => () => undefined)
}));

vi.mock('../lib/product-client.js', () => ({
  product: {
    app: {
      setFullScreen: h.setFullScreen,
      onFullScreenChanged: h.onFullScreenChanged
    }
  }
}));

import { InspectorResizeHandles } from './InspectorResizeHandles.js';
import { useInspectorWindow } from './useInspectorWindow.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.style.cssText = '';
});

function Harness() {
  const windowState = useInspectorWindow();
  return (
    <div
      ref={windowState.ref}
      data-testid="inspector"
      className={windowState.className}
      style={windowState.style}
    >
      <InspectorResizeHandles
        hidden={windowState.fullScreen}
        onBegin={windowState.beginResize}
        onMove={windowState.moveResize}
        onEnd={windowState.endResize}
        onReset={windowState.resetFrame}
        onKey={windowState.keyResize}
      />
    </div>
  );
}

function mockRect() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(400, 200, 800, 600)
  );
  vi.stubGlobal('innerWidth', 1600);
  vi.stubGlobal('innerHeight', 1000);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
}

describe('inspector window resize', () => {
  it('captures a southeast drag and expands both sides equally', () => {
    mockRect();
    render(<Harness />);
    const handle = screen.getByTestId('inspector-resize-se');
    Object.assign(handle, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: () => true
    });
    fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 1000, clientY: 680 });
    expect(handle.setPointerCapture).not.toHaveBeenCalled();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 1000, clientY: 680 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 1200, clientY: 800 });
    expect(screen.getByTestId('inspector').style.width).toBe('800px');
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1080, clientY: 760 });
    const inspector = screen.getByTestId('inspector');
    expect(inspector.style.width).toBe('960px');
    expect(inspector.style.height).toBe('760px');
    expect(inspector.style.left).toBe('320px');
    expect(inspector.style.top).toBe('120px');
    expect(inspector.className).toContain('is-resizing');
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(inspector.className).not.toContain('is-resizing');
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1400, clientY: 900 });
    expect(inspector.style.width).toBe('960px');
  });

  it('clamps a custom frame when the viewport shrinks', () => {
    mockRect();
    render(<Harness />);
    const handle = screen.getByTestId('inspector-resize-se');
    Object.assign(handle, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: () => true
    });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 1000, clientY: 680 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1080, clientY: 760 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 });
    fireEvent(window, new Event('resize'));
    const inspector = screen.getByTestId('inspector');
    expect(Number.parseInt(inspector.style.width, 10)).toBe(500 - 32);
    expect(Number.parseInt(inspector.style.height, 10)).toBe(400 - 32);
  });

  it('resets on double-click and keyboard Enter, and grows from arrow keys', () => {
    mockRect();
    render(<Harness />);
    const handle = screen.getByRole('separator', { name: 'Resize agent window' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(screen.getByTestId('inspector').style.width).toBe('824px');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(screen.getByTestId('inspector').style.width).toBe('640px');
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(screen.getByTestId('inspector').style.width).toBe('');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(screen.getByTestId('inspector').style.height).toBe('624px');
    fireEvent.doubleClick(handle);
    expect(screen.getByTestId('inspector').style.height).toBe('');
    fireEvent.keyDown(handle, { key: 'Tab' });
    expect(screen.getByTestId('inspector').style.height).toBe('');
  });

  it('hides handles in fullscreen and keeps the custom size for exit', () => {
    h.setFullScreen.mockClear();
    mockRect();
    function FullScreenHarness() {
      const windowState = useInspectorWindow();
      return (
        <div ref={windowState.ref} data-testid="inspector" className={windowState.className} style={windowState.style}>
          <button type="button" onClick={windowState.toggleFullScreen}>
            toggle-fs
          </button>
          <InspectorResizeHandles
            hidden={windowState.fullScreen}
            onBegin={windowState.beginResize}
            onMove={windowState.moveResize}
            onEnd={windowState.endResize}
            onReset={windowState.resetFrame}
            onKey={windowState.keyResize}
          />
        </div>
      );
    }
    render(<FullScreenHarness />);
    const handle = screen.getByTestId('inspector-resize-se');
    Object.assign(handle, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: () => true
    });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 1000, clientY: 680 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1080, clientY: 760 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(screen.getByTestId('inspector').style.width).toBe('960px');
    fireEvent.pointerDown(screen.getByText('toggle-fs'));
    fireEvent.click(screen.getByText('toggle-fs'));
    expect(h.setFullScreen).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('inspector').className).toContain('is-fullscreen');
    expect(screen.queryByTestId('inspector-resize-se')).toBeNull();
    expect(screen.getByTestId('inspector').style.width).toBe('');
    fireEvent.click(screen.getByText('toggle-fs'));
    expect(screen.getByTestId('inspector-resize-se')).toBeTruthy();
    expect(screen.getByTestId('inspector').style.width).toBe('960px');
  });
});
