import type { LaunchProfileId } from '@zana-ai/zcc-domain/product';
import type { ExecutionNativeRecoverySnapshotV1 } from '@zana-ai/zcc-server/services/execution/store';
import { registrationFor } from '@zana-ai/zcc-host-daemon/harness/registry';

type RecoverySlot = Pick<ExecutionNativeRecoverySnapshotV1, 'slotId' | 'role' | 'personaId' | 'profileId' | 'nativeConversationId' | 'transport'>
  & Partial<Pick<ExecutionNativeRecoverySnapshotV1, 'threadId' | 'generation' | 'providerThreadId' | 'providerId' | 'hostId' | 'environmentPath'>>;

/** What a Modern slot must match to be resumed on its stored provider thread. `hostId` is optional: main enforces it at launch when availability cannot resolve it. */
export interface ModernSlotExpectation { providerId: string; hostId?: string; environmentPath: string }

/**
 * Derive a provider-native resume launch from trusted durable state. The current
 * slot identity fences snapshots from a former persona/profile assignment.
 * CLI only: a MODERN snapshot, or any snapshot on a MODERN team, never yields a CLI resume.
 */
export function nativeRecoveryProjection(input: {
  recovery?: { mode: 'exact-native'; slots: Array<RecoverySlot> };
  slotId: string;
  role: 'worker' | 'orchestrator';
  personaId: string;
  profile: LaunchProfileId;
  teamTransport?: 'CLI' | 'MODERN';
}) {
  if (input.recovery?.mode !== 'exact-native' || input.teamTransport === 'MODERN') return undefined;
  const snapshot = input.recovery.slots.find((candidate) =>
    // A Modern provider thread id is never a CLI resume id; the Modern fence is a separate path.
    candidate.transport !== 'MODERN'
    && candidate.slotId === input.slotId
    && candidate.role === input.role
    && candidate.personaId === input.personaId
    && candidate.profileId === input.profile
  );
  if (!snapshot) return undefined;
  return registrationFor(input.profile)?.nativeConversationResume?.(snapshot.nativeConversationId);
}

/**
 * Modern identity fence: the snapshot must belong to this slot (slot, role, persona,
 * profile) AND the same provider, host and worktree. Any drift is "not restorable";
 * a snapshot is never remapped to another slot or provider.
 */
export function modernRecoverySnapshot<T extends RecoverySlot>(input: {
  snapshots: ReadonlyArray<T>;
  slotId: string;
  role: 'worker' | 'orchestrator';
  personaId: string;
  profile: LaunchProfileId;
  teamTransport?: 'CLI' | 'MODERN';
  expected?: ModernSlotExpectation;
}): T | undefined {
  if (input.teamTransport !== 'MODERN' || !input.expected) return undefined;
  const expected = input.expected;
  return input.snapshots.find((candidate) =>
    candidate.transport === 'MODERN'
    && candidate.slotId === input.slotId
    && candidate.role === input.role
    && candidate.personaId === input.personaId
    && candidate.profileId === input.profile
    && typeof candidate.threadId === 'string' && candidate.threadId.length > 0
    && Number.isSafeInteger(candidate.generation) && (candidate.generation ?? 0) >= 1
    && typeof candidate.providerThreadId === 'string' && candidate.providerThreadId.length > 0
    && candidate.providerThreadId === candidate.nativeConversationId
    && candidate.providerId === expected.providerId
    && (expected.hostId === undefined || candidate.hostId === expected.hostId)
    && typeof candidate.hostId === 'string' && candidate.hostId.length > 0
    && candidate.environmentPath === expected.environmentPath);
}

type RecoverySlotInput = { slotId: string; role: 'worker' | 'orchestrator'; personaId: string; profile: LaunchProfileId; modern?: ModernSlotExpectation };

/** Aggregate only: native ids stay in main while board UI learns current support. */
export function exactNativeRecoveryAvailability(input: {
  snapshots: ReadonlyArray<RecoverySlot>;
  slots: ReadonlyArray<RecoverySlotInput>;
  teamTransport?: 'CLI' | 'MODERN';
}): { available: boolean; restorableSlots: number } {
  const restorableSlots = compatibleNativeRecoverySnapshots(input).length;
  return { available: restorableSlots > 0, restorableSlots };
}

/** Main-only exact-native candidates fenced against the current Team slot identity. */
export function compatibleNativeRecoverySnapshots<T extends RecoverySlot>(input: {
  snapshots: ReadonlyArray<T>;
  slots: ReadonlyArray<RecoverySlotInput>;
  teamTransport?: 'CLI' | 'MODERN';
}): T[] {
  return input.snapshots.filter((snapshot) => input.slots.some((slot) => snapshot.transport === 'MODERN'
    ? modernRecoverySnapshot({ snapshots: [snapshot], slotId: slot.slotId, role: slot.role, personaId: slot.personaId,
      profile: slot.profile, teamTransport: input.teamTransport, expected: slot.modern }) !== undefined
    : nativeRecoveryProjection({
      recovery: { mode: 'exact-native', slots: [snapshot] },
      slotId: slot.slotId,
      role: slot.role,
      personaId: slot.personaId,
      profile: slot.profile,
      teamTransport: input.teamTransport
    }) !== undefined));
}

/** Main-only selection shared by authorization binding and terminal spawn. */
export function nativeRecoveryLaunchSlot(input: Parameters<typeof nativeRecoveryProjection>[0]) {
  const recovery = nativeRecoveryProjection(input);
  return {
    configuredProfile: input.profile,
    profile: recovery?.profile ?? input.profile,
    ...(recovery?.resumeSessionId ? { resumeSessionId: recovery.resumeSessionId } : {}),
    ...(recovery?.extraArgs ? { extraArgs: recovery.extraArgs } : {}),
    recoveryResume: recovery !== undefined
  };
}
