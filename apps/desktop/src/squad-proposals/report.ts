import type { ExecutionRecord } from '@zana-ai/zcc-server/services/execution/store';
import { SQUAD_PROPOSAL_LIMITS } from '@zana-ai/zcc-domain/squad-proposal';
import type { SquadWorktreeTerminalOutcome } from '../squad-worktree-lifecycle.js';

type Blocker = NonNullable<ExecutionRecord['blockers']>[number];

/** What the Squad worktree terminal handler actually did; absent when the run had no worktree. */
export type SquadWorktreeOutcome = SquadWorktreeTerminalOutcome;

const SUMMARY_CHARS = 600;
const QUESTION_CHARS = 300;
const BRANCH_CHARS = 200;
const PATH_CHARS = 300;
const CLOSING = 'Tell the user. Do not change the Squad\'s work or answer its questions; answers go through the Inbox.';

const OUTCOME: Record<string, string> = { COMPLETED: 'completed', FAILED: 'failed', STOPPED: 'stopped' };

/**
 * Squad-written text (title, summary, blocker question, branch, path) is typed into the
 * proposer's terminal. Replace every C0/C1 control character (ESC, CR, LF, bracketed-paste
 * markers, Shift+Tab sequences, …) with a space, then collapse whitespace, so a report can
 * never inject keystrokes and always stays on one line.
 */
function oneLine(text: string | undefined): string {
  return (text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function trimTo(text: string, max: number): string {
  if (max <= 0) return '';
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function squadOutcomeLabel(state: string): string {
  return OUTCOME[state] ?? 'ended';
}

export function formatSquadDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function branchText(record: ExecutionRecord, worktree: SquadWorktreeOutcome | undefined): string {
  const recorded = record.squadWorktree;
  if (!recorded) return 'Worked in the project folder';
  const branch = trimTo(oneLine(recorded.branch), BRANCH_CHARS);
  if (worktree === 'merged') {
    return `Branch ${branch} merged into ${trimTo(oneLine(recorded.baseBranch), BRANCH_CHARS) || 'the base branch'}`;
  }
  if (worktree === 'missing') return `Branch ${branch}; its worktree was already removed`;
  return `Branch ${branch}, worktree kept at ${trimTo(oneLine(recorded.path), PATH_CHARS)}`;
}

/** Last resort: keep the closing sentence whole and cut the text before it. */
function withClosing(head: string, max: number): string {
  const room = max - CLOSING.length - 1;
  return `${trimTo(head, room)} ${CLOSING}`;
}

/** One line, at most 2048 chars. The summary is cut first, then the title; the closing sentence never is. */
export function buildSquadReport(record: ExecutionRecord, opts: { worktree?: SquadWorktreeOutcome } = {}): string {
  const units = record.workUnits ?? [];
  const count = (state: string) => units.filter((unit) => unit.state === state).length;
  const middle = `${branchText(record, opts.worktree)}. Units: ${count('COMPLETED')} done, ${count('FAILED')} failed, ${count('SKIPPED')} skipped.`;
  const duration = formatSquadDuration((record.updatedAt ?? 0) - (record.createdAt ?? 0));
  const outcome = squadOutcomeLabel(record.state);
  let title = oneLine(record.jobTitle);
  let summary = trimTo(oneLine(record.finalSummary), SUMMARY_CHARS);
  const head = () => `[Squad report] "${title}" ${outcome} after ${duration}. ${middle} Summary: ${summary || 'none'}${/[.!?…]$/.test(summary) ? '' : '.'}`;
  const max = SQUAD_PROPOSAL_LIMITS.reportChars;
  const assemble = () => `${head()} ${CLOSING}`;
  let text = assemble();
  if (text.length > max) {
    summary = trimTo(summary, summary.length - (text.length - max));
    text = assemble();
  }
  if (text.length > max) {
    title = trimTo(title, title.length - (text.length - max));
    text = assemble();
  }
  return text.length > max ? withClosing(head(), max) : text;
}

export function buildSquadBlockerReport(record: ExecutionRecord, blocker: Blocker): string {
  const max = SQUAD_PROPOSAL_LIMITS.reportChars;
  let title = oneLine(record.jobTitle);
  const question = trimTo(oneLine(blocker.question), QUESTION_CHARS);
  const assemble = () => `[Squad report] "${title}" is waiting for an answer in the Inbox: "${question}". Tell the user; do not answer it yourself.`;
  let text = assemble();
  if (text.length > max) {
    title = trimTo(title, title.length - (text.length - max));
    text = assemble();
  }
  return text;
}
