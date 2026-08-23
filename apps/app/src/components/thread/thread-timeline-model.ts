import type { AgentState } from '@zana-ai/zcc-domain/product';
import type { ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';

export function isBusyThreadStatus(status: string): boolean {
  return status === 'starting' || status === 'active' || status === 'stopping';
}

export function shouldShowThreadStop(threadId: string | undefined, status: string | undefined): boolean {
  return Boolean(threadId) && isBusyThreadStatus(status ?? '');
}

/** Map a conversation-thread status onto the agent-board lanes. */
export function threadStatusToAgentState(status: string): AgentState {
  if (isBusyThreadStatus(status)) return 'working';
  if (status === 'error') return 'blocked';
  return 'idle';
}

export function threadStatusLabel(status: string): string {
  const trimmed = status.trim();
  if (!trimmed) return '';
  return trimmed.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
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
