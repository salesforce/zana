// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeStickyUserPrompts } from './timeline-sticky-user.js';

afterEach(() => vi.unstubAllGlobals());

function fixture(heights: number[], viewport = 600, replyHeights?: number[]) {
  const pane = document.createElement('div');
  pane.innerHTML = heights.map(() => '<div class="thread-timeline-current-turn"><div class="thread-timeline-item is-user"></div><div class="thread-timeline-item is-assistant"></div></div>').join('');
  const prompts = Array.from(pane.querySelectorAll<HTMLElement>('.is-user'));
  const turns = Array.from(pane.querySelectorAll<HTMLElement>('.thread-timeline-current-turn'));
  const size = { viewport, heights, replyHeights: replyHeights ?? heights.map(() => 0) };
  Object.defineProperty(pane, 'clientHeight', { get: () => size.viewport });
  prompts.forEach((prompt, index) => {
    Object.defineProperty(prompt, 'offsetHeight', { get: () => size.heights[index] });
  });
  turns.forEach((turn, index) => {
    Object.defineProperty(turn, 'offsetHeight', {
      get: () => (size.replyHeights[index] ? size.heights[index]! + size.replyHeights[index]! : size.heights[index]!)
    });
  });
  let resize = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    observe = observe;
    disconnect = disconnect;
    constructor(callback: () => void) { resize = callback; }
  });
  const dispose = observeStickyUserPrompts(pane);
  const pinned = () => prompts.map((prompt) => prompt.hasAttribute('data-sticky-prompt'));
  return { pane, prompts, turns, size, observe, disconnect, resize: () => resize(), dispose, pinned };
}

describe('prompt pinning', () => {
  it('pins small prompts but lets tall prompts scroll out of the reply area', () => {
    const f = fixture([80, 300, 301, 1600, 0]);
    expect(f.pinned()).toEqual([true, true, false, false, false]);
    expect(f.observe.mock.calls.map(([node]) => node)).toEqual([f.pane, ...f.prompts, ...f.turns]);
    f.dispose();
  });

  it('unpins expanded content and restores pinning when it collapses', () => {
    const f = fixture([120]);
    f.size.heights[0] = 2000;
    f.resize();
    expect(f.pinned()).toEqual([false]);
    f.size.heights[0] = 120;
    f.resize();
    expect(f.pinned()).toEqual([true]);
    f.dispose();
  });

  it('rechecks after viewport resizing and handles a hidden timeline', () => {
    const f = fixture([200]);
    f.size.viewport = 300;
    f.resize();
    expect(f.pinned()).toEqual([false]);
    f.size.viewport = 800;
    f.resize();
    expect(f.pinned()).toEqual([true]);
    f.size.viewport = 0;
    f.resize();
    expect(f.pinned()).toEqual([false]);
    f.dispose();
  });

  it('unpins when the transcript no longer leaves room for the reply underneath it (#669)', () => {
    // Prompt is 180px, reply is 150px (turn is 330px).
    const f = fixture([180], 450, [150]);
    // At viewport 450, maxHeight is 225, turn 330 <= 450: leaves plenty of room.
    expect(f.pinned()).toEqual([true]);
    // Composer expands: viewport shortens to 300 (turn 330 > 300: prompt would cover reply).
    f.size.viewport = 300;
    f.resize();
    expect(f.pinned()).toEqual([false]);
    // Composer collapses: viewport restores to 450.
    f.size.viewport = 450;
    f.resize();
    expect(f.pinned()).toEqual([true]);
    f.dispose();
  });

  it('allows pinning across long multi-screen replies while unpinning short overlapping replies', () => {
    // Turn 0: prompt 100px, multi-screen reply 1200px.
    // Turn 1: prompt 100px, short reply 250px (total 350px in a 300px viewport).
    const f = fixture([100, 100], 300, [1200, 250]);
    // Turn 0: reply 1200 > viewport 300, prompt 100 <= 150 -> pins.
    // Turn 1: reply 250 <= viewport 300, turn 350 > viewport 300 -> unpins.
    expect(f.pinned()).toEqual([true, false]);
    f.dispose();
  });

  it('disconnects and clears markers when rows change or the timeline unmounts', () => {
    const f = fixture([80, 1500]);
    f.dispose();
    expect(f.disconnect).toHaveBeenCalledOnce();
    expect(f.pinned()).toEqual([false, false]);
  });

  it('does not observe an empty timeline', () => {
    const f = fixture([]);
    expect(f.observe).not.toHaveBeenCalled();
    f.dispose();
  });

  it('leaves prompts in normal flow when resize observation is unavailable', () => {
    const f = fixture([80]);
    f.dispose();
    vi.stubGlobal('ResizeObserver', undefined);
    const dispose = observeStickyUserPrompts(f.pane);
    expect(f.pinned()).toEqual([false]);
    dispose();
  });
});
