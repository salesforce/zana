import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoundsStateController, restoreWindowState, type BoundsWindow, type DisplayWorkArea } from '../bounds-state.js';

const primary: DisplayWorkArea = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };
const secondary: DisplayWorkArea = { id: 2, workArea: { x: 1440, y: 0, width: 1280, height: 800 } };

function windowStub(overrides: Partial<BoundsWindow> = {}): BoundsWindow {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    isMaximized: () => false,
    isNormal: () => true,
    isFullScreen: () => false,
    unmaximize: () => {},
    setBounds: () => {},
    getNormalBounds: () => ({ x: 10, y: 20, width: 1000, height: 700 }),
    ...overrides
  };
}

afterEach(() => vi.useRealTimers());

describe('createBoundsStateController', () => {
  it('flushes latest bounds once when closed before debounce expires', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const controller = createBoundsStateController({ win: windowStub(), write });
    controller.scheduleBounds();
    controller.flush();
    vi.advanceTimersByTime(400);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({
      windowBounds: { x: 10, y: 20, width: 1000, height: 700 },
      windowMaximized: false
    });
  });

  it('does not save minimized, maximized, or fullscreen geometry', () => {
    const write = vi.fn();
    for (const win of [
      windowStub({ isMinimized: () => true, isNormal: () => false }),
      windowStub({ isFullScreen: () => true, isNormal: () => false })
    ]) {
      const controller = createBoundsStateController({ win, write });
      controller.scheduleBounds();
    }
    expect(write).not.toHaveBeenCalled();
  });

  it('persists maximize without replacing retained normal bounds', () => {
    const write = vi.fn();
    const controller = createBoundsStateController({
      win: windowStub(),
      initialBounds: { x: 80, y: 80, width: 1000, height: 700 },
      write
    });
    controller.setMaximized(true);
    controller.flushForClose();
    expect(write).toHaveBeenCalledWith({
      windowBounds: { x: 80, y: 80, width: 1000, height: 700 },
      windowMaximized: true
    });
  });

  it('detects a window already maximized before controller setup', () => {
    const write = vi.fn();
    const controller = createBoundsStateController({
      win: windowStub({ isMaximized: () => true }),
      initialBounds: { x: 80, y: 80, width: 1000, height: 700 },
      write
    });
    controller.flushForClose();
    expect(write).toHaveBeenCalledWith({
      windowBounds: { x: 80, y: 80, width: 1000, height: 700 },
      windowMaximized: true
    });
  });

  it('discards resize geometry emitted while native maximize starts', () => {
    vi.useFakeTimers();
    let nativeBounds = { x: 10, y: 20, width: 1000, height: 700 };
    const write = vi.fn();
    const controller = createBoundsStateController({
      win: windowStub({ getNormalBounds: () => nativeBounds }),
      initialBounds: nativeBounds,
      write
    });
    nativeBounds = { x: 0, y: 0, width: 1440, height: 900 };
    controller.scheduleBounds();
    controller.setMaximized(true);
    vi.advanceTimersByTime(400);
    controller.flushForClose();
    expect(write).toHaveBeenCalledWith({
      windowBounds: { x: 10, y: 20, width: 1000, height: 700 },
      windowMaximized: true
    });
  });

  it('snapshots normal bounds before fullscreen transition and ignores transition geometry', () => {
    const write = vi.fn();
    const controller = createBoundsStateController({ win: windowStub(), write });
    controller.beginFullscreenTransition();
    controller.scheduleBounds();
    controller.flush();
    expect(write).toHaveBeenCalledWith({
      windowBounds: { x: 10, y: 20, width: 1000, height: 700 },
      windowMaximized: false
    });
  });

  it('treats native fullscreen as transient', () => {
    const write = vi.fn();
    const controller = createBoundsStateController({
      win: windowStub({ isFullScreen: () => true }),
      initialBounds: { x: 10, y: 20, width: 1000, height: 700 },
      write
    });
    controller.beginFullscreenTransition();
    expect(write).toHaveBeenCalledWith({
      windowBounds: { x: 10, y: 20, width: 1000, height: 700 },
      windowMaximized: false
    });
  });

  it('does not write after window destruction', () => {
    const write = vi.fn();
    const controller = createBoundsStateController({ win: windowStub({ isDestroyed: () => true }), write });
    controller.scheduleBounds();
    controller.flush();
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps native maximize state on close', () => {
    const write = vi.fn();
    const controller = createBoundsStateController({
      win: windowStub({ isMaximized: () => true, isNormal: () => false }),
      initialBounds: { x: 10, y: 20, width: 1000, height: 700 },
      write
    });
    controller.setMaximized(true);
    controller.flushForClose();
    expect(write).toHaveBeenCalledWith({
      windowBounds: { x: 10, y: 20, width: 1000, height: 700 },
      windowMaximized: true
    });
  });
});

describe('restoreWindowState', () => {
  it('relocates stale bounds and clamps dimensions to target work area', () => {
    expect(restoreWindowState({ x: 5000, y: 0, width: 2000, height: 1000 }, undefined, [primary, secondary], primary)).toMatchObject({
      bounds: { x: 0, y: 0, width: 1440, height: 900 }
    });
  });

  it('restores zoom/maximize independently from normal bounds', () => {
    expect(
      restoreWindowState(
        { x: 100, y: 80, width: 1000, height: 700 },
        true,
        [primary, secondary],
        primary
      )
    ).toMatchObject({
      bounds: { x: 100, y: 80, width: 1000, height: 700 },
      maximized: true
    });
  });

});
