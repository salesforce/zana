import { parseProfile } from '@zana-ai/zcc-domain/launch-provider';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';

export interface HostThreadView {
  id: string;
  projectId: string;
  providerId: string;
  status: string;
  title: string | null;
  createdAt: number;
  environmentId?: string | null;
  cwd?: string | null;
  branchName?: string | null;
  isWorktree?: boolean;
}

export function sessionFromHostThread(
  thread: HostThreadView,
  project?: { path?: string }
): TerminalSession {
  const profile = parseProfile(thread.providerId) ?? 'claude';
  const exited = thread.status === 'failed'
    || thread.status === 'completed'
    || thread.status === 'disconnected';
  const cwd = thread.cwd ?? project?.path ?? '';
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title?.trim() || 'Agent',
    profile,
    cwd,
    status: exited ? 'exited' : thread.status === 'starting' ? 'starting' : 'running',
    createdAt: thread.createdAt,
    workspaceEnvironmentId: thread.environmentId ?? undefined,
    worktree: thread.isWorktree && cwd
      ? { path: cwd, branch: thread.branchName ?? '' }
      : undefined
  };
}

export function threadEventToTerminalData(payload: unknown): { sessionId: string; data: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const event = payload as { threadId?: unknown; kind?: unknown; payload?: unknown };
  if (event.kind !== 'terminal.output' || typeof event.threadId !== 'string') return null;
  const inner = event.payload;
  const data = inner && typeof inner === 'object' && 'data' in inner
    ? (inner as { data: unknown }).data
    : undefined;
  return typeof data === 'string' ? { sessionId: event.threadId, data } : null;
}

export function threadEventToTerminalExit(payload: unknown): { sessionId: string; code: number } | null {
  if (!payload || typeof payload !== 'object') return null;
  const event = payload as { threadId?: unknown; kind?: unknown; payload?: unknown };
  if (event.kind !== 'turn.completed' && event.kind !== 'turn.failed') return null;
  if (typeof event.threadId !== 'string') return null;
  const inner = event.payload;
  const exitCode = inner && typeof inner === 'object' && 'exitCode' in inner
    ? (inner as { exitCode: unknown }).exitCode
    : 0;
  return { sessionId: event.threadId, code: typeof exitCode === 'number' ? exitCode : 0 };
}
