import type { ThreadActivityState } from '@zana-ai/zcc-domain/thread-runtime';

export type ThreadListIndicatorKind =
  | 'unread-error'
  | 'waiting-for-input'
  | 'plan-mode'
  | 'workflow'
  | 'background-command'
  | 'runtime'
  | 'none';

const LABELS: Record<Exclude<ThreadListIndicatorKind, 'none'>, string> = {
  'unread-error': 'Unread thread failed',
  'waiting-for-input': 'Thread needs user input',
  'plan-mode': 'Plan mode active',
  workflow: 'Workflow running',
  'background-command': 'Background command running',
  runtime: 'Thread working'
};

export function getThreadListIndicatorLabel(kind: ThreadListIndicatorKind): string | null {
  return kind === 'none' ? null : LABELS[kind];
}

export function resolveThreadListIndicator(state: {
  hasUnreadError: boolean;
  hasPendingInteraction: boolean;
  isPlanModeActive: boolean;
  isRuntimeActive: boolean;
  isWorkflowActive: boolean;
  isBackgroundCommandActive: boolean;
}): ThreadListIndicatorKind {
  if (state.hasUnreadError) return 'unread-error';
  if (state.hasPendingInteraction) return 'waiting-for-input';
  if (state.isPlanModeActive) return 'plan-mode';
  if (state.isRuntimeActive) return 'runtime';
  if (state.isWorkflowActive) return 'workflow';
  if (state.isBackgroundCommandActive) return 'background-command';
  return 'none';
}

export function threadListIndicatorState(thread: {
  status: string;
  hasPendingInteraction?: boolean;
  lastReadSeq?: number | null;
  maxSeq?: number;
  activity?: ThreadActivityState;
  runtime?: { displayStatus: string };
}): Parameters<typeof resolveThreadListIndicator>[0] {
  const display = thread.runtime?.displayStatus ?? thread.status;
  const unread = (thread.lastReadSeq ?? -1) < (thread.maxSeq ?? 0);
  return {
    hasUnreadError: thread.status === 'error' && unread,
    hasPendingInteraction: display !== 'error' && Boolean(thread.hasPendingInteraction),
    isPlanModeActive: (thread.activity?.activePlanModeCount ?? 0) > 0,
    isRuntimeActive: display === 'active' || display === 'host-reconnecting' || display === 'starting',
    isWorkflowActive: (thread.activity?.activeWorkflowCount ?? 0) > 0,
    isBackgroundCommandActive: (thread.activity?.activeBackgroundCommandCount ?? 0) > 0
  };
}
