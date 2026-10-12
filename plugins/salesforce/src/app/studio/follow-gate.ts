import type { UiCommand } from '../../../lib/workbench-control.js';
import { validateUiCommandInput } from '../../../lib/ui-command-input.js';

/**
 * Commands that move the editor or the view under the user. Proposals already wait for the user,
 * and preview runs and panel changes leave the cursor alone, so those always apply at once.
 */
export const REVEAL_COMMANDS: ReadonlySet<string> = new Set(['file.open', 'editor.reveal', 'trace.focus', 'graph.focus']);
/** An edit newer than this means the person is still typing. */
export const TYPING_IDLE_MS = 2000;

export type HoldReason = 'typing' | 'paused';
export interface HeldReveal { command: UiCommand; reason: HoldReason; label: string; who: string }

/**
 * A reveal the executor would reject: bad input, or a file switch over an unsaved or busy draft.
 * Such a reveal is never held, so the agent hears the error now.
 */
function refusedReveal({ command, input }: UiCommand, dirty: boolean): boolean {
  if (validateUiCommandInput(command, input)) return true;
  if (command === 'editor.reveal') return !Number.isInteger(input.line) || Number(input.line) < 1;
  if (command === 'file.open') return dirty || typeof input.path !== 'string' || !input.path || input.path.length > 4000;
  return false;
}

/**
 * Why a reveal must wait instead of moving the editor now, or null when it can apply.
 * The person's own click in another window (`user`) is what they asked for, so it never waits.
 * `dirty` is true while the draft has unsaved edits or a save is running.
 */
export function holdReason(command: UiCommand, follow: { paused: boolean; lastEditAt: number; now: number; dirty?: boolean }): HoldReason | null {
  if (command.user || !REVEAL_COMMANDS.has(command.command) || refusedReveal(command, follow.dirty === true)) return null;
  if (follow.paused) return 'paused';
  return follow.lastEditAt > 0 && follow.now - follow.lastEditAt < TYPING_IDLE_MS ? 'typing' : null;
}

/** "open Help.agent", "go to line 12": what the toast offers to do. */
export function revealLabel(command: UiCommand): string {
  const input = command.input;
  if (command.command === 'file.open') return `open ${String(input.path ?? '').split('/').pop() || 'a file'}`;
  if (command.command === 'editor.reveal') return `go to line ${String(input.line)}`;
  if (command.command === 'trace.focus') return 'show the trace';
  return typeof input.node === 'string' && input.node ? `show ${input.node} in the graph` : 'show the graph';
}

/** Who sent the command, for the chip and the toast. */
export function commandAuthor(command: Pick<UiCommand, 'from'>): string {
  return command.from?.title?.trim() || 'The agent';
}

export function holdCommand(command: UiCommand, reason: HoldReason): HeldReveal {
  return { command, reason, label: revealLabel(command), who: commandAuthor(command) };
}
