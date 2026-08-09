// Purpose: reusable test harness for the capture-phase keydown handler in
//   shortcuts.ts — stubs window/navigator (node env, no jsdom) and dispatches
//   synthetic chords so shortcut branches can be asserted in isolation.
// External calls: None.
// Updated: 2026-07-03 15:20Z

import { vi } from 'vitest';

type Handler = (e: KeyboardEvent) => void;

interface Chord {
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  /** DOM `code` (e.g. 'Digit1'); defaults to '' — set for digit/bracket chords. */
  code?: string;
}

export interface KeyboardHarness {
  /** Dispatch one keydown to every capture-phase listener; returns the event. */
  press: (key: string, chord?: Chord) => { preventDefault: ReturnType<typeof vi.fn> };
  /** Remove the window/navigator stubs. Call in afterEach. */
  teardown: () => void;
}

/**
 * Install a minimal window (a keydown event bus) + a Mac navigator, so
 * `installShortcuts()` can register on `window` and tests can `press()` chords.
 * Must run BEFORE `installShortcuts()`. Mac by default so ⌘ is the mod key;
 * pass a ctrl chord to exercise the non-Mac path.
 */
export function installKeyboardHarness(): KeyboardHarness {
  const listeners: Handler[] = [];
  const g = globalThis as { window?: unknown };
  const prevWindow = g.window;
  // navigator is a getter-only global in node — redefine it, capturing the
  // prior descriptor so teardown can restore it exactly.
  const prevNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  g.window = {
    addEventListener: (type: string, fn: Handler) => {
      if (type === 'keydown') listeners.push(fn);
    },
    removeEventListener: (type: string, fn: Handler) => {
      if (type !== 'keydown') return;
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    }
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform: 'MacIntel' },
    configurable: true,
    writable: true
  });

  const press = (key: string, chord: Chord = {}) => {
    const preventDefault = vi.fn();
    const e = {
      key,
      code: chord.code ?? '',
      metaKey: !!chord.meta,
      ctrlKey: !!chord.ctrl,
      shiftKey: !!chord.shift,
      preventDefault
    } as unknown as KeyboardEvent;
    for (const fn of [...listeners]) fn(e);
    return { preventDefault };
  };

  const teardown = () => {
    g.window = prevWindow;
    if (prevNavigator) Object.defineProperty(globalThis, 'navigator', prevNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  };

  return { press, teardown };
}
