import type { ScheduleRunConversation } from '@zana-ai/zcc-domain/product';
import { isValidConversationId } from '@zana-ai/zcc-domain/schedule-health';
import type { registrationFor } from '@zana-ai/zcc-host-daemon/harness/registry';

type Registration = ReturnType<typeof registrationFor>;
type SessionLike = { cwd: string; createdAt?: number };

/**
 * The conversation a freshly launched agent session can be reopened from, shared by
 * the scheduler and the goal manager so the two cannot drift. Recorded only for a
 * harness that can resume, and only when the id is known now or can be detected later.
 */
export function buildRunConversation(
  registration: Registration,
  session: SessionLike,
  profile: ScheduleRunConversation['profile'],
  fallbackStartedAt: string
): ScheduleRunConversation | undefined {
  const launchId = registration?.nativeConversationId?.(session as never);
  if (!registration?.nativeConversationResume || !(launchId || registration.createTranscriptAdapter)) return undefined;
  const created = session.createdAt;
  return {
    profile,
    id: launchId,
    cwd: session.cwd,
    startedAt: typeof created === 'number' && Number.isFinite(created) ? new Date(created).toISOString() : fallbackStartedAt
  };
}

/** The conversation with a detected id filled in, or undefined when there is nothing to add. */
export function withDetectedConversationId(
  conversation: ScheduleRunConversation | undefined,
  registration: Registration,
  session: SessionLike | undefined
): ScheduleRunConversation | undefined {
  if (!conversation || conversation.id || !session) return undefined;
  const detectedId = registration?.nativeConversationId?.(session as never);
  return isValidConversationId(detectedId) ? { ...conversation, id: detectedId } : undefined;
}
