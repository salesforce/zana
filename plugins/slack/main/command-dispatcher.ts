/**
 * Inbound command parsing + dispatch for the live bot.
 *
 * The grammar is intentionally tiny (Phase 1): `run <prompt>`, `status`,
 * `help`. `cancel`/`hint` parse but reply "not supported yet" — there is no
 * SDK verb to control a running session from the main process, so honestly
 * saying so beats pretending. The parser shape is ported from CU's
 * `command-dispatcher`; the actions are ZCC's.
 *
 * The dispatcher stays transport-agnostic: it receives a `postReply` callback
 * (the pollers wire it to a thread reply) and an `enqueueLaunch` callback (the
 * pollers wire it to slack-main's pending-launch queue, drained by the
 * renderer where `launchSession` lives).
 */

import type { BotCommand, InboundSlackMessage } from '../shared/types.js';

/** Parse a raw message body into a {@link BotCommand}. Case-insensitive verb. */
export function parseCommand(text: string | undefined): BotCommand {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { kind: 'empty' };

  const match = /^(\w+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return { kind: 'unknown', raw: trimmed };
  const verb = match[1].toLowerCase();
  const rest = (match[2] ?? '').trim();

  switch (verb) {
    case 'run':
      return rest ? { kind: 'run', prompt: rest } : { kind: 'unknown', raw: trimmed };
    case 'status':
      return { kind: 'status' };
    case 'help':
      return { kind: 'help' };
    case 'cancel':
    case 'stop':
      return { kind: 'cancel' };
    case 'hint':
      return rest ? { kind: 'hint', text: rest } : { kind: 'unknown', raw: trimmed };
    default:
      return { kind: 'unknown', raw: trimmed };
  }
}

/** Where the bot launches a session from a `run` command. */
export interface LaunchIntent {
  prompt: string;
  channel: string;
  parentTs: string;
}

/**
 * A text reply to type into the session bound to a thread (`hint`/`cancel`).
 * Keyed by channel+parentTs; BotRuntime resolves it to the linked session.
 */
export interface ReplyIntent {
  channel: string;
  parentTs: string;
  text: string;
  /** Short label for the in-thread confirmation (e.g. "hint", "cancel"). */
  label: string;
  /** Deliver raw (no trailing Enter) — for control keys like Esc. */
  raw?: boolean;
}

export interface DispatcherDeps {
  /** Queue a launch intent for the renderer to execute. Returns the queued id. */
  readonly enqueueLaunch: (intent: LaunchIntent) => string;
  /** Queue a text reply into the thread's session (hint/cancel). */
  readonly enqueueReply: (intent: ReplyIntent) => void;
  /** Produce a human-readable status line (bot health + active sessions). */
  readonly statusText: () => string;
}

const HELP_TEXT = [
  '*ZCC bot commands*',
  '• `run <prompt>` — launch a Claude session in the default project; I reply in this thread',
  '• `status` — bot health + sessions I launched',
  '• `hint <text>` — type a line into this thread’s session',
  '• `cancel` — interrupt this thread’s session (sends Esc)',
  '• `help` — this message',
  '',
  '_In a session thread you can also react :white_check_mark:/:x: on an approval prompt._',
  '_The bot only runs while ZCC is open._'
].join('\n');

/** Esc — Claude Code's TUI interrupt key. Sent as the `cancel` reply. */
const ESC = String.fromCharCode(27);

export class CommandDispatcher {
  constructor(private readonly deps: DispatcherDeps) {}

  /**
   * Act on one inbound message. `parentTs` is the thread the reply should land
   * in: the message's own ts for a top-level post (opens a thread), or the
   * existing parent for a threaded reply.
   */
  async dispatch(
    msg: InboundSlackMessage,
    channel: string,
    parentTs: string,
    postReply: (text: string) => Promise<void>
  ): Promise<void> {
    const cmd = parseCommand(msg.text);
    switch (cmd.kind) {
      case 'run': {
        this.deps.enqueueLaunch({ prompt: cmd.prompt, channel, parentTs });
        await postReply(`:rocket: Launching a session for: ${truncate(cmd.prompt, 140)}`);
        return;
      }
      case 'status':
        await postReply(this.deps.statusText());
        return;
      case 'help':
        await postReply(HELP_TEXT);
        return;
      case 'cancel':
        // Esc interrupts Claude's current turn. Sent RAW (no trailing Enter —
        // an Enter after Esc could submit a stray prompt). Resolved to this
        // thread's session by BotRuntime; it confirms (or reports no session).
        this.deps.enqueueReply({ channel, parentTs, text: ESC, label: 'cancel', raw: true });
        return;
      case 'hint':
        this.deps.enqueueReply({ channel, parentTs, text: cmd.text, label: 'hint' });
        return;
      case 'empty':
        // Bot-posted parents and blank messages: stay silent.
        return;
      case 'unknown':
        await postReply(`:grey_question: I didn't understand that. Try \`help\`.`);
        return;
    }
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
