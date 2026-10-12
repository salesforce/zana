import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAdjacentPaneId,
  getDirectionalPaneId,
  paneCommandDirection,
  paneCommandFocusIndex,
  paneCommandsAvailable,
  registerPaneCommandHandler,
  runPaneCommand
} from './paneCommands.js';
import type { LayoutNode, PaneNode } from './types.js';

function pane(paneId: string): PaneNode {
  return { type: 'pane', paneId, content: { kind: 'thread', projectId: 'p1', threadId: paneId } };
}

function split(dir: 'row' | 'col', children: LayoutNode[], sizes?: number[]): LayoutNode {
  return { type: 'split', dir, sizes: sizes ?? children.map(() => 1 / children.length), children };
}

// ┌───┬───┐
// │ a │ b │
// │   ├───┤
// │   │ c │
// └───┴───┘
const tShape = split('row', [pane('a'), split('col', [pane('b'), pane('c')])]);

describe('paneCommandDirection / paneCommandFocusIndex', () => {
  it('maps directional commands to sides', () => {
    expect(paneCommandDirection('pane.focus.left')).toBe('left');
    expect(paneCommandDirection('pane.focus.right')).toBe('right');
    expect(paneCommandDirection('pane.focus.up')).toBe('top');
    expect(paneCommandDirection('pane.focus.down')).toBe('bottom');
    expect(paneCommandDirection('pane.close')).toBeNull();
  });

  it('maps numbered commands to zero-based indexes', () => {
    expect(paneCommandFocusIndex('pane.focus.1')).toBe(0);
    expect(paneCommandFocusIndex('pane.focus.8')).toBe(7);
    expect(paneCommandFocusIndex('pane.focus.next')).toBeNull();
  });
});

describe('getAdjacentPaneId', () => {
  const panes = [pane('a'), pane('b'), pane('c')];

  it('cycles forward and backward with wraparound', () => {
    expect(getAdjacentPaneId(panes, 'a', 1)).toBe('b');
    expect(getAdjacentPaneId(panes, 'c', 1)).toBe('a');
    expect(getAdjacentPaneId(panes, 'a', -1)).toBe('c');
  });

  it('starts from the first pane when the focused id is unknown', () => {
    expect(getAdjacentPaneId(panes, 'missing', 1)).toBe('b');
  });

  it('returns null with fewer than two panes', () => {
    expect(getAdjacentPaneId([pane('a')], 'a', 1)).toBeNull();
    expect(getAdjacentPaneId([], 'a', 1)).toBeNull();
  });
});

describe('getDirectionalPaneId', () => {
  it('moves across a row and within a column', () => {
    expect(getDirectionalPaneId(tShape, 'b', 'left')).toBe('a');
    expect(getDirectionalPaneId(tShape, 'c', 'left')).toBe('a');
    expect(getDirectionalPaneId(tShape, 'b', 'bottom')).toBe('c');
    expect(getDirectionalPaneId(tShape, 'c', 'top')).toBe('b');
  });

  it('breaks ties by the closest cross-axis centre', () => {
    // a spans the full height; b sits higher than c, but both touch a. Sizes
    // put b's centre closer to a's centre, so moving right from a picks b.
    const root = split('row', [pane('a'), split('col', [pane('b'), pane('c')], [0.6, 0.4])]);
    expect(getDirectionalPaneId(root, 'a', 'right')).toBe('b');
    const flipped = split('row', [pane('a'), split('col', [pane('b'), pane('c')], [0.3, 0.7])]);
    expect(getDirectionalPaneId(flipped, 'a', 'right')).toBe('c');
  });

  it('prefers the nearest pane over a farther one', () => {
    const root = split('row', [pane('a'), pane('b'), pane('c')]);
    expect(getDirectionalPaneId(root, 'a', 'right')).toBe('b');
    expect(getDirectionalPaneId(root, 'c', 'left')).toBe('b');
  });

  it('returns null at an edge, for a non-overlapping pane, or for an unknown id', () => {
    expect(getDirectionalPaneId(tShape, 'a', 'left')).toBeNull();
    expect(getDirectionalPaneId(tShape, 'a', 'top')).toBeNull();
    expect(getDirectionalPaneId(tShape, 'b', 'right')).toBeNull();
    // 2x2 grid: top-left's diagonal neighbour never overlaps on either axis.
    const grid = split('col', [
      split('row', [pane('tl'), pane('tr')]),
      split('row', [pane('bl'), pane('br')])
    ]);
    expect(getDirectionalPaneId(grid, 'tl', 'right')).toBe('tr');
    expect(getDirectionalPaneId(grid, 'tl', 'bottom')).toBe('bl');
    expect(getDirectionalPaneId(tShape, 'missing', 'left')).toBeNull();
  });
});

describe('pane command handler registry', () => {
  const releases: Array<() => void> = [];
  afterEach(() => {
    while (releases.length) releases.pop()?.();
  });

  it('reports unavailable and unhandled with no handler', () => {
    expect(paneCommandsAvailable()).toBe(false);
    expect(runPaneCommand('pane.close')).toBe(false);
  });

  it('routes commands to the registered handler and returns its result', () => {
    const handler = vi.fn((command: string) => command === 'pane.close');
    releases.push(registerPaneCommandHandler(handler));
    expect(paneCommandsAvailable()).toBe(true);
    expect(runPaneCommand('pane.close')).toBe(true);
    expect(runPaneCommand('pane.focus.next')).toBe(false);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('a stale release does not clear a newer registration', () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const releaseFirst = registerPaneCommandHandler(first);
    releases.push(registerPaneCommandHandler(second));
    releaseFirst();
    expect(paneCommandsAvailable()).toBe(true);
    runPaneCommand('pane.close');
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});
