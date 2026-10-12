import { computePaneRects } from './computePaneRects.js';
import type { LayoutNode, PaneNode, SplitSide } from './types.js';

export type PaneCommandId =
  | 'pane.focus.left'
  | 'pane.focus.right'
  | 'pane.focus.up'
  | 'pane.focus.down'
  | 'pane.focus.previous'
  | 'pane.focus.next'
  | 'pane.focus.1'
  | 'pane.focus.2'
  | 'pane.focus.3'
  | 'pane.focus.4'
  | 'pane.focus.5'
  | 'pane.focus.6'
  | 'pane.focus.7'
  | 'pane.focus.8'
  | 'pane.maximize.toggle'
  | 'pane.close';

export const PANE_FOCUS_INDEX_COMMANDS = [
  'pane.focus.1',
  'pane.focus.2',
  'pane.focus.3',
  'pane.focus.4',
  'pane.focus.5',
  'pane.focus.6',
  'pane.focus.7',
  'pane.focus.8'
] as const satisfies readonly PaneCommandId[];

/** Commands surfaced by name (Settings, palette). Numbered focus stays keyboard-only. */
export const NAMED_PANE_COMMANDS: ReadonlyArray<{
  command: PaneCommandId;
  label: string;
  help: string;
}> = [
  { command: 'pane.focus.left', label: 'Focus pane left', help: 'Focus the split pane to the left of the current one.' },
  { command: 'pane.focus.right', label: 'Focus pane right', help: 'Focus the split pane to the right of the current one.' },
  { command: 'pane.focus.up', label: 'Focus pane above', help: 'Focus the split pane above the current one.' },
  { command: 'pane.focus.down', label: 'Focus pane below', help: 'Focus the split pane below the current one.' },
  { command: 'pane.focus.previous', label: 'Focus previous pane', help: 'Cycle backward through split panes.' },
  { command: 'pane.focus.next', label: 'Focus next pane', help: 'Cycle forward through split panes.' },
  { command: 'pane.maximize.toggle', label: 'Maximize or restore pane', help: 'Toggle the focused split pane between maximized and restored.' },
  { command: 'pane.close', label: 'Close pane', help: 'Close the focused split pane when more than one is open.' }
];

const DIRECTION_BY_COMMAND: Partial<Record<PaneCommandId, SplitSide>> = {
  'pane.focus.left': 'left',
  'pane.focus.right': 'right',
  'pane.focus.up': 'top',
  'pane.focus.down': 'bottom'
};

export function paneCommandDirection(command: PaneCommandId): SplitSide | null {
  return DIRECTION_BY_COMMAND[command] ?? null;
}

export function paneCommandFocusIndex(command: PaneCommandId): number | null {
  const index = (PANE_FOCUS_INDEX_COMMANDS as readonly string[]).indexOf(command);
  return index === -1 ? null : index;
}

export function getAdjacentPaneId(
  panes: readonly PaneNode[],
  focusedPaneId: string,
  offset: -1 | 1
): string | null {
  if (panes.length < 2) return null;
  const focusedIndex = panes.findIndex((pane) => pane.paneId === focusedPaneId);
  const startIndex = focusedIndex === -1 ? 0 : focusedIndex;
  return panes[(startIndex + offset + panes.length) % panes.length]?.paneId ?? null;
}

const EPSILON = 1e-9;

/**
 * Nearest pane on `direction` that overlaps the focused pane on the cross
 * axis; ties go to the pane whose centre is closest on that axis.
 */
export function getDirectionalPaneId(
  root: LayoutNode,
  focusedPaneId: string,
  direction: SplitSide
): string | null {
  const rects = computePaneRects(root);
  const focused = rects.get(focusedPaneId);
  if (!focused) return null;
  const horizontal = direction === 'left' || direction === 'right';
  const forward = direction === 'right' || direction === 'bottom';
  const start = horizontal ? focused.x : focused.y;
  const size = horizontal ? focused.w : focused.h;
  const crossStart = horizontal ? focused.y : focused.x;
  const crossSize = horizontal ? focused.h : focused.w;
  let nearest: string | null = null;
  let nearestGap = Infinity;
  let nearestOffset = Infinity;
  for (const [paneId, rect] of rects) {
    if (paneId === focusedPaneId) continue;
    const candidateStart = horizontal ? rect.x : rect.y;
    const candidateSize = horizontal ? rect.w : rect.h;
    const candidateCrossStart = horizontal ? rect.y : rect.x;
    const candidateCrossSize = horizontal ? rect.h : rect.w;
    const overlap =
      Math.min(crossStart + crossSize, candidateCrossStart + candidateCrossSize) -
      Math.max(crossStart, candidateCrossStart);
    const gap = forward ? candidateStart - start - size : start - candidateStart - candidateSize;
    if (gap < -EPSILON || overlap <= EPSILON) continue;
    const offset = Math.abs(
      candidateCrossStart + candidateCrossSize / 2 - crossStart - crossSize / 2
    );
    if (gap < nearestGap - EPSILON || (Math.abs(gap - nearestGap) <= EPSILON && offset < nearestOffset)) {
      nearest = paneId;
      nearestGap = gap;
      nearestOffset = offset;
    }
  }
  return nearest;
}

type PaneCommandHandler = (command: PaneCommandId) => boolean;

let activeHandler: PaneCommandHandler | null = null;

/**
 * The mounted split workspace owns pane commands while a split is visible.
 * Returns a release function that only clears its own registration.
 */
export function registerPaneCommandHandler(handler: PaneCommandHandler): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

export function paneCommandsAvailable(): boolean {
  return activeHandler !== null;
}

/** True when a split workspace handled the command. */
export function runPaneCommand(command: PaneCommandId): boolean {
  return activeHandler?.(command) ?? false;
}
