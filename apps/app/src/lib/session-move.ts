import { create } from 'zustand';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { ThreadListItem } from '../thread-store.js';

interface SessionMoveState {
  request: { threadId: string; destinationId?: string } | null;
  primaryHostId: string | undefined;
  open(threadId: string, destinationId?: string): void;
  close(): void;
}

export const useSessionMove = create<SessionMoveState>((set) => ({
  request: null,
  primaryHostId: undefined,
  open: (threadId, destinationId) => set({ request: { threadId, destinationId } }),
  close: () => set({ request: null })
}));

export function sessionMoveReason(
  thread: Pick<ThreadListItem, 'projectId' | 'hostId'>, project: Project, primaryHostId?: string
): string | null {
  if (project.id === thread.projectId) return 'Current project';
  const hostId = project.hostId ?? (project.remote ? undefined : primaryHostId);
  return hostId === thread.hostId ? null : 'Other machine';
}

export function sessionNeedsStop(thread: Pick<ThreadListItem, 'status' | 'activity'>): boolean {
  return ['active', 'starting', 'stopping'].includes(thread.status)
    || Object.values(thread.activity ?? {}).some(count => count > 0);
}
