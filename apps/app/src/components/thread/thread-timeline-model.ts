import type { AgentState } from '@zana-ai/zcc-domain/product';
import type { ActiveThinking, ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';

export function isBusyThreadStatus(status: string): boolean {
  return status === 'starting' || status === 'active' || status === 'stopping';
}

export function shouldShowThreadStop(threadId: string | undefined, status: string | undefined): boolean {
  return Boolean(threadId) && isBusyThreadStatus(status ?? '');
}

/** Map a conversation-thread status onto the agent-board lanes. */
export function threadStatusToAgentState(status: string, waitingOnUser = false): AgentState {
  if (status === 'error') return 'idle';
  if (waitingOnUser) return 'blocked';
  if (isBusyThreadStatus(status)) return 'working';
  return 'idle';
}

/** Visual tone for a thread status chip/dot. Errors keep the danger look without
 *  borrowing the `blocked` / "Needs you" lane — a failed run is not a prompt. */
export function threadStatusTone(
  status: string,
  waitingOnUser = false
): AgentState | 'error' {
  if (status === 'error') return 'error';
  return threadStatusToAgentState(status, waitingOnUser);
}

export function threadStatusLabel(
  status: string,
  waitingOnUser = false,
  thinking?: ActiveThinking | null
): string {
  const trimmed = status.trim();
  if (!trimmed) return '';
  if (trimmed === 'error') return 'Error';
  if (waitingOnUser) return 'Needs you';
  if (isBusyThreadStatus(trimmed)) return thinking ? 'Thinking' : 'Working';
  if (trimmed === 'idle') return 'Idle';
  return trimmed.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function timelineRowsAwaitUser(rows: readonly TimelineRow[] | null | undefined): boolean {
  if (!rows?.length) return false;
  for (const row of rows) {
    if (row.kind === 'turn') {
      if (timelineRowsAwaitUser(row.children)) return true;
      continue;
    }
    if (row.kind !== 'work') continue;
    if (row.workKind === 'question') {
      if (row.lifecycle === 'pending' || row.lifecycle === 'resolving') return true;
      continue;
    }
    if (row.workKind === 'approval') {
      if (row.lifecycle === 'waiting' || row.lifecycle === 'pending' || row.lifecycle === 'resolving') {
        return true;
      }
      continue;
    }
    if (row.workKind === 'delegation' && timelineRowsAwaitUser(row.childRows)) return true;
  }
  return false;
}

export function visiblePendingTodos(
  todos: ThreadTimelinePendingTodos | null | undefined
): ThreadTimelinePendingTodos | null {
  if (!todos?.items.length) return null;
  if (todos.items.every((item) => item.status === 'completed')) return null;
  return todos;
}

export function workRowBody(row: {
  workKind?: string;
  output?: string;
  change?: {
    path?: string;
    diff?: string | null;
    diffStats?: { added: number; removed: number };
  };
  queries?: string[];
  url?: string;
  path?: string;
  description?: string;
  summary?: string | null;
  questions?: unknown;
}): string {
  switch (row.workKind) {
    case 'command':
    case 'tool':
    case 'delegation':
      return typeof row.output === 'string' ? row.output : '';
    case 'file-change': {
      const stats = row.change?.diffStats;
      const tally = stats ? `+${stats.added} −${stats.removed}` : '';
      return [row.change?.path, tally, row.change?.diff].filter(Boolean).join('\n');
    }
    case 'web-search':
      return (row.queries ?? []).join('\n');
    case 'web-fetch':
      return row.url ?? '';
    case 'image-view':
      return row.path ?? '';
    case 'workflow':
      return row.summary || row.description || '';
    case 'question':
      return Array.isArray(row.questions)
        ? row.questions.map((question) => {
          if (question && typeof question === 'object' && 'prompt' in question) {
            return String((question as { prompt: unknown }).prompt);
          }
          return '';
        }).filter(Boolean).join('\n')
        : '';
    default:
      return '';
  }
}
