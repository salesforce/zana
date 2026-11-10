// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeStickyUserPrompts } from './timeline-sticky-user.js';

afterEach(() => vi.unstubAllGlobals());

function fixture(heights: number[], viewport = 600, replyHeights?: number[]) {
  const pane = document.createElement('div');
  pane.innerHTML = heights.map(() => '<div class="thread-timeline-current-turn"><div class="thread-timeline-item is-user"></div><div class="thread-timeline-item is-assistant"></div></div>').join('');
  const prompts = Array.from(pane.querySelectorAll<HTMLElement>('.is-user'));
  const turns = Array.from(pane.querySelectorAll<HTMLElement>('.thread-timeline-current-turn'));
  const replies = Array.from(pane.querySelectorAll<HTMLElement>('.is-assistant'));
  const size = { viewport, heights, replyHeights: replyHeights ?? heights.map(() => 0) };
  Object.defineProperty(pane, 'clientHeight', { configurable: true, get: () => size.viewport });
  prompts.forEach((prompt, index) => {
    Object.defineProperty(prompt, 'offsetHeight', {
      configurable: true,
      get: () => size.heights[index]
    });
  });
  replies.forEach((reply, index) => {
    Object.defineProperty(reply, 'offsetHeight', {
      configurable: true,
      get: () => size.replyHeights[index]
    });
  });
  turns.forEach((turn, index) => {
    Object.defineProperty(turn, 'offsetHeight', {
      configurable: true,
      get: () => size.heights[index]! + size.replyHeights[index]!
    });
  });
  let resize = (_entries?: ResizeObserverEntry[]) => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    observe = observe;
    disconnect = disconnect;
    constructor(callback: ResizeObserverCallback) {
      resize = (entries) => callback(entries ?? [{ target: pane } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
  });
  const dispose = observeStickyUserPrompts(pane);
  const pinned = () => prompts.map((prompt) => prompt.hasAttribute('data-sticky-prompt'));
  return {
    pane,
    prompts,
    turns,
    replies,
    size,
    observe,
    disconnect,
    resize: (...targets: HTMLElement[]) =>
      resize(
        targets.length > 0
          ? targets.map((t) => ({ target: t } as ResizeObserverEntry))
          : [{ target: pane } as ResizeObserverEntry]
      ),
    dispose,
    pinned
  };
}

describe('prompt pinning', () => {
  it('pins small prompts but lets tall prompts scroll out of the reply area', () => {
    const f = fixture([80, 300, 301, 1600, 0]);
    expect(f.pinned()).toEqual([true, true, false, false, false]);
    expect(f.observe.mock.calls.map(([node]) => node)).toEqual([
      f.pane,
      ...f.prompts.flatMap((prompt, i) => [prompt, f.turns[i]!])
    ]);
    f.dispose();
  });

  it('unpins when composer expansion shortens the transcript so the turn no longer fits', () => {
    // Prompt 100px, reply 150px in a 300px pane (turn 250px <= 300px -> fits, pins).
    const f = fixture([100], 300, [150]);
    expect(f.pinned()).toEqual([true]);
    // Composer expands: transcript pane shrinks to 200px (turn 250px > 200px, reply 150px <= 300px -> unpins).
    f.size.viewport = 200;
    f.resize();
    expect(f.pinned()).toEqual([false]);
    // Composer collapses: transcript pane expands back to 300px.
    f.size.viewport = 300;
    f.resize();
    expect(f.pinned()).toEqual([true]);
    f.dispose();
  });

  it('unpins at exact height boundary when reply cannot scroll clear of prompt', () => {
    // pane 300, prompt 100.
    // Turn height = 300 (reply 200): fits in viewport without scrolling -> pinned.
    const f1 = fixture([100], 300, [200]);
    expect(f1.pinned()).toEqual([true]);
    f1.dispose();

    // Turn height = 301 (reply 201): exceeds viewport by 1px, reply <= 400 -> overlaps, unpinned.
    const f2 = fixture([100], 300, [201]);
    expect(f2.pinned()).toEqual([false]);
    f2.dispose();

    // Turn height = 500 (reply 400): exceeds viewport, reply == 400 (pane + prompt) -> overlaps, unpinned.
    const f3 = fixture([100], 300, [400]);
    expect(f3.pinned()).toEqual([false]);
    f3.dispose();

    // Turn height = 501 (reply 401): reply > 400 (can scroll clear of 100px prompt) -> pinned.
    const f4 = fixture([100], 300, [401]);
    expect(f4.pinned()).toEqual([true]);
    f4.dispose();
  });

  it('keeps prompts pinned when long replies can scroll clear of the pinned prompt', () => {
    // Multi-screen reply: prompt 100px, reply 1000px in a 300px pane.
    // Reply height (1000px) > paneHeight + promptHeight (400px), so it can scroll clear.
    const f = fixture([100], 300, [1000]);
    expect(f.pinned()).toEqual([true]);
    // Even if composer expands and pane shrinks to 200px, 1000px reply > 300px -> still pins.
    f.size.viewport = 200;
    f.resize();
    expect(f.pinned()).toEqual([true]);
    f.dispose();
  });

  it('keeps prompts pinned when the entire turn fits comfortably within the shortened transcript', () => {
    // Short turn: prompt 50px, reply 50px in a 200px shortened pane.
    // prompt + reply (100px) <= paneHeight (200px) -> entire turn fits in viewport.
    const f = fixture([50], 200, [50]);
    expect(f.pinned()).toEqual([true]);
    f.dispose();
  });

  it('updates pin state when earlier reply content resizes independently', () => {
    // Turn 0: prompt 100px, reply 150px in a 300px pane (turn 250px <= 300px -> fits, pins).
    // Turn 1: prompt 100px, reply 1000px in a 300px pane (multi-screen -> pins).
    const f = fixture([100, 100], 300, [150, 1000]);
    expect(f.pinned()).toEqual([true, true]);
    // Earlier turn's reply expands (e.g. image loads, tool block expands) to 250px (turn 350px > 300px, reply 250px <= 400px -> unpins).
    f.size.replyHeights[0] = 250;
    f.resize(f.turns[0]!);
    expect(f.pinned()).toEqual([false, true]);
    f.dispose();
  });

  it('updates pin state when reply height grows dynamically without a pane resize', () => {
    // Prompt 100px, reply starts at 150px in a 300px pane (turn 250px <= 300px -> fits, pins).
    const f = fixture([100], 300, [150]);
    expect(f.pinned()).toEqual([true]);
    // Reply grows to 250px during streaming/rendering (turn 350px > 300px, reply 250px <= 400px -> unpins to avoid overlap).
    f.size.replyHeights[0] = 250;
    f.resize(f.turns[0]!);
    expect(f.pinned()).toEqual([false]);
    // Reply grows to a large multi-screen reply 1000px (> 400px -> re-pins).
    f.size.replyHeights[0] = 1000;
    f.resize(f.turns[0]!);
    expect(f.pinned()).toEqual([true]);
    f.dispose();
  });

  it('recomputes only the affected turn in O(1) when a streaming chunk resizes one turn', () => {
    // 3 turns in a 300px pane.
    const f = fixture([100, 100, 100], 300, [150, 150, 150]);
    expect(f.pinned()).toEqual([true, true, true]);

    // Spy on turn 0 and turn 1 items to ensure they are NOT read during turn 2 resize
    let turn0Read = false;
    let turn1Read = false;
    Object.defineProperty(f.replies[0]!, 'offsetHeight', {
      configurable: true,
      get: () => { turn0Read = true; return 150; }
    });
    Object.defineProperty(f.replies[1]!, 'offsetHeight', {
      configurable: true,
      get: () => { turn1Read = true; return 150; }
    });
    Object.defineProperty(f.prompts[0]!, 'offsetHeight', {
      configurable: true,
      get: () => { turn0Read = true; return 100; }
    });
    Object.defineProperty(f.prompts[1]!, 'offsetHeight', {
      configurable: true,
      get: () => { turn1Read = true; return 100; }
    });

    // Turn 2 grows during streaming to 250px (turn 350px > 300px, reply 250px <= 400px -> unpins)
    f.size.replyHeights[2] = 250;
    f.resize(f.turns[2]!);

    expect(f.pinned()).toEqual([true, true, false]);
    expect(turn0Read).toBe(false);
    expect(turn1Read).toBe(false);
    f.dispose();
  });

  it('measures reply height directly so inter-row margin does not shift overlap boundary', () => {
    // Pane 300, prompt 100, reply 200.
    // prompt + reply = 300 <= paneHeight (300).
    // If turn offsetHeight includes 12px margin (100 + 12 + 200 = 312 > 300),
    // a naive turn.offsetHeight - prompt.offsetHeight would calculate reply as 212px,
    // which would cause turn (100 + 212 = 312 > 300) to be treated as overlapping and unpinned!
    // Measuring the reply row directly (200px) correctly keeps it pinned.
    const f = fixture([100], 300, [200]);
    Object.defineProperty(f.turns[0]!, 'offsetHeight', {
      configurable: true,
      get: () => 312
    });
    f.resize(f.turns[0]!);
    expect(f.pinned()).toEqual([true]);
    f.dispose();
  });

  it('supports multiple user prompts in a single turn without counting them as reply height', () => {
    const pane = document.createElement('div');
    pane.innerHTML = `
      <div class="thread-timeline-current-turn">
        <div class="thread-timeline-item is-user" id="p1"></div>
        <div class="thread-timeline-item is-user" id="p2"></div>
        <div class="thread-timeline-item is-assistant" id="r1"></div>
      </div>
    `;
    const prompts = Array.from(pane.querySelectorAll<HTMLElement>('.is-user'));
    const turn = pane.querySelector<HTMLElement>('.thread-timeline-current-turn')!;
    const reply = pane.querySelector<HTMLElement>('.is-assistant')!;

    Object.defineProperty(pane, 'clientHeight', { configurable: true, get: () => 400 });
    // p1 = 60px, p2 = 80px, reply = 150px
    Object.defineProperty(prompts[0]!, 'offsetHeight', { configurable: true, get: () => 60 });
    Object.defineProperty(prompts[1]!, 'offsetHeight', { configurable: true, get: () => 80 });
    Object.defineProperty(reply, 'offsetHeight', { configurable: true, get: () => 150 });

    let resizeCallback: ResizeObserverCallback = () => {};
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(cb: ResizeObserverCallback) { resizeCallback = cb; }
    });

    const dispose = observeStickyUserPrompts(pane);
    // In a 400px pane:
    // For p1 (60px): reply is 150px. 60 + 150 = 210 <= 400 -> fits, pinned.
    // For p2 (80px): reply is 150px. 80 + 150 = 230 <= 400 -> fits, pinned.
    expect(prompts.map((p) => p.hasAttribute('data-sticky-prompt'))).toEqual([true, true]);

    // Now reply grows to 350px:
    // For p1 (60px): 60 + 350 = 410 > 400, reply 350 <= 460 -> overlaps, unpins.
    // For p2 (80px): 80 + 350 = 430 > 400, reply 350 <= 480 -> overlaps, unpins.
    Object.defineProperty(reply, 'offsetHeight', { configurable: true, get: () => 350 });
    resizeCallback([{ target: turn } as ResizeObserverEntry], {} as ResizeObserver);

    // Both prompts in that turn must be re-evaluated and unpinned
    expect(prompts.map((p) => p.hasAttribute('data-sticky-prompt'))).toEqual([false, false]);
    dispose();
  });

  it('batches layout reads before attribute writes when multiple entries resize in one callback', () => {
    const f = fixture([100, 100], 300, [150, 150]);
    const operations: string[] = [];

    for (let i = 0; i < 2; i++) {
      const prompt = f.prompts[i]!;
      const reply = f.replies[i]!;
      const origPromptHeight = Object.getOwnPropertyDescriptor(prompt, 'offsetHeight')!;
      Object.defineProperty(prompt, 'offsetHeight', {
        configurable: true,
        get: () => {
          operations.push(`read:prompt:${i}`);
          return origPromptHeight.get!.call(prompt);
        }
      });
      const origReplyHeight = Object.getOwnPropertyDescriptor(reply, 'offsetHeight')!;
      Object.defineProperty(reply, 'offsetHeight', {
        configurable: true,
        get: () => {
          operations.push(`read:reply:${i}`);
          return origReplyHeight.get!.call(reply);
        }
      });
      const origToggle = prompt.toggleAttribute.bind(prompt);
      prompt.toggleAttribute = vi.fn((name: string, force?: boolean) => {
        operations.push(`write:prompt:${i}`);
        return origToggle(name, force);
      });
    }

    // Both turns grow to 250px so they unpin
    f.size.replyHeights[0] = 250;
    f.size.replyHeights[1] = 250;
    operations.length = 0;

    f.resize(f.turns[0]!, f.turns[1]!);

    const firstWriteIndex = operations.findIndex((op) => op.startsWith('write:'));
    const lastReadIndex = operations.map((op, idx) => ({ op, idx })).filter((x) => x.op.startsWith('read:')).pop()?.idx ?? -1;
    expect(firstWriteIndex).toBeGreaterThan(-1);
    expect(lastReadIndex).toBeGreaterThan(-1);
    expect(firstWriteIndex).toBeGreaterThan(lastReadIndex);

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
