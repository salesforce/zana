import { getConversationThread } from '@zana-ai/zcc-db';
import { threadOpenSignalSchema, type ThreadOpenSignal } from '@zana-ai/zcc-server-contract';
import type { ProductHttpContext } from '../../http/product-context.js';

export const RUN_IN_TERMINAL_COMMAND_MAX = 10_000;
export const RUN_IN_TERMINAL_TITLE_MAX = 200;

export class RunInTerminalError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'RunInTerminalError';
  }
}

export interface OpenThreadTerminalInput {
  threadId: string;
  projectId?: string;
  command?: string | null;
  title?: string | null;
}

export interface OpenThreadTerminalResult {
  delivered: number;
  threadId: string;
  projectId: string;
  command: string | null;
  title: string | null;
}

export interface OpenThreadTerminalDeps {
  getThread(id: string): { id: string; projectId: string } | null;
  getProject(projectId: string): { id: string; remote?: unknown } | null;
  emit(payload: ThreadOpenSignal): number;
}

export function openThreadTerminalDepsFromContext(ctx: ProductHttpContext): OpenThreadTerminalDeps {
  return {
    getThread: (id) => {
      const thread = getConversationThread(ctx.db, id);
      return thread ? { id: thread.id, projectId: thread.projectId } : null;
    },
    getProject: (projectId) => ctx.toProjects().find((project) => project.id === projectId) ?? null,
    emit: (payload) => {
      ctx.hub.emit('threads:open', payload);
      return ctx.hub.size();
    }
  };
}

function trimBounded(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new RunInTerminalError(400, 'invalid-request', `run_in_terminal ${label} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new RunInTerminalError(400, 'invalid-request', `run_in_terminal ${label} is too long`);
  }
  return trimmed;
}

/**
 * Authorize a visible in-app shell and broadcast `threads:open` with a terminal
 * intent. The renderer creates the PtyManager shell (Rule 1: identity from the
 * owning thread/session, never agent-supplied). Remote projects fail closed.
 */
export function openThreadTerminal(
  deps: OpenThreadTerminalDeps,
  input: OpenThreadTerminalInput
): OpenThreadTerminalResult {
  const thread = deps.getThread(input.threadId);
  const projectId = thread?.projectId ?? input.projectId;
  if (!projectId) {
    throw new RunInTerminalError(404, 'unknown-thread', 'thread is not registered');
  }
  const project = deps.getProject(projectId);
  if (!project) {
    throw new RunInTerminalError(404, 'unknown-project', 'project is not registered');
  }
  if (project.remote) {
    throw new RunInTerminalError(
      409,
      'remote-unsupported',
      'In-app terminals are not available on remote projects.'
    );
  }

  const command = trimBounded(input.command, RUN_IN_TERMINAL_COMMAND_MAX, 'command');
  const title = trimBounded(input.title, RUN_IN_TERMINAL_TITLE_MAX, 'title');
  const tabTitle = (title ?? command ?? 'Terminal').slice(0, RUN_IN_TERMINAL_TITLE_MAX);
  const signal = threadOpenSignalSchema.parse({
    type: 'thread-open',
    projectId,
    threadId: thread?.id ?? input.threadId,
    split: 'right',
    file: null,
    terminal: {
      command,
      title: tabTitle
    }
  });
  const delivered = deps.emit(signal);
  return {
    delivered,
    threadId: signal.threadId,
    projectId,
    command,
    title: signal.terminal?.title ?? null
  };
}
