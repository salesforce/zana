// @vitest-environment happy-dom
import { createElement, type ComponentProps } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) =>
    createElement('a', props, children)
}));
import { ProductDemo, CompactDemo } from './ProductDemo';
import {
  FLOW_LOOP_MS,
  T_KANBAN,
  T_DIAGRAM,
  T_TOOL_EDIT,
  sceneForElapsed
} from './flow-scene';

let clock = 0;
let serial = 0;
let frames = new Map<number, FrameRequestCallback>();
let visibility: (entries: { isIntersecting: boolean }[]) => void;
let mediaChange: () => void;
let reduced = false;
const disconnect = vi.fn();
const removeListener = vi.fn();

beforeEach(() => {
  clock = 0;
  serial = 0;
  reduced = false;
  frames = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, callback: () => void) => {
      mediaChange = callback;
    },
    removeEventListener: removeListener
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof visibility) {
        visibility = callback;
      }
      observe() {
        visibility([{ isIntersecting: true }]);
      }
      disconnect = disconnect;
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function frame(time: number) {
  clock = time;
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(time)));
}
function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name, exact: true }));
}

describe('visitor-controlled demo', () => {
  it('starts still and lets visitors inspect every chapter', () => {
    render(createElement(ProductDemo));
    expect(frames.size).toBe(0);
    expect(
      screen
        .getByRole('button', { name: 'Start a task' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    click('Follow progress');
    expect(
      screen.getByRole('heading', { name: 'The Agents board' })
    ).toBeTruthy();
    click('Answer a question');
    expect(screen.getByRole('heading', { name: 'Your Inbox' })).toBeTruthy();
    click('Review the result');
    expect(screen.getByRole('heading', { name: 'Your Thread' })).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Review the result' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    click('Restart');
    expect(screen.getByRole('heading', { name: 'New Chat' })).toBeTruthy();
  });

  it('plays, pauses without losing progress, and stops at the result', () => {
    render(createElement(ProductDemo));
    click('Play demo');
    frame(10); // Frames below the paint interval do not need a React update.
    frame(T_KANBAN + 100);
    expect(
      screen.getByRole('heading', { name: 'The Agents board' })
    ).toBeTruthy();
    click('Pause demo');
    expect(frames.size).toBe(0);
    click('Play demo');
    frame(FLOW_LOOP_MS + 100);
    expect(screen.getByRole('button', { name: 'Play demo' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your Thread' })).toBeTruthy();
    expect(frames.size).toBe(0);
    click('Play demo');
    expect(screen.getByRole('heading', { name: 'New Chat' })).toBeTruthy();
  });

  it('suspends offscreen and cleans up animation and observers', () => {
    const { unmount } = render(createElement(ProductDemo));
    click('Play demo');
    frame(500);
    act(() => visibility([{ isIntersecting: false }]));
    expect(frames.size).toBe(0);
    clock = 50000;
    act(() => visibility([{ isIntersecting: true }]));
    frame(50100);
    expect(screen.getByRole('heading', { name: 'New Chat' })).toBeTruthy();
    unmount();
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith('change', mediaChange);
  });

  it('keeps chapter selection available with reduced motion, including live preference changes', () => {
    reduced = true;
    render(createElement(ProductDemo));
    expect(screen.queryByRole('button', { name: 'Play demo' })).toBeNull();
    click('Review the result');
    expect(screen.getByRole('heading', { name: 'Your Thread' })).toBeTruthy();
    act(() => {
      reduced = false;
      mediaChange();
    });
    click('Play demo');
    act(() => {
      reduced = true;
      mediaChange();
    });
    expect(frames.size).toBe(0);
    expect(screen.queryByRole('button', { name: 'Pause demo' })).toBeNull();
  });

  it('can restart playback from the question chapter', () => {
    render(createElement(ProductDemo));
    click('Answer a question');
    click('Play demo');
    expect(screen.getByRole('heading', { name: 'New Chat' })).toBeTruthy();
    click('Review the result');
    expect(frames.size).toBe(0);
  });
});

describe('readable mobile walkthrough', () => {
  it.each([0, T_KANBAN, T_TOOL_EDIT, T_DIAGRAM])(
    'renders useful task context at time %i',
    (time) => {
      const { container } = render(
        createElement(CompactDemo, {
          scene: sceneForElapsed(time),
          inbox: false
        })
      );
      expect(screen.getByRole('heading').textContent).toBe(
        'Fix the flaky checkout tests'
      );
      expect(container.textContent).toContain('Checkout project');
      if (time >= T_TOOL_EDIT)
        expect(container.textContent).toContain('mockStripe.reset()');
    }
  );
  it('explains how the answer reaches the agent', () => {
    render(
      createElement(CompactDemo, { scene: sceneForElapsed(0), inbox: true })
    );
    expect(screen.getByRole('heading').textContent).toContain('retry budget');
    expect(
      screen.getByText(/Your answer goes back to the waiting agent/)
    ).toBeTruthy();
  });
});
