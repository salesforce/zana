import type { LaunchProfileId } from '@zana-ai/zcc-domain/product';
import type { ExecutionNativeRecoverySnapshotV1 } from '@zana-ai/zcc-server/services/execution/store';
import { registrationFor } from '@zana-ai/zcc-host-daemon/harness/registry';

/**
 * Derive a provider-native resume launch from trusted durable state. The current
 * slot identity fences snapshots from a former persona/profile assignment.
 */
export function nativeRecoveryProjection(input: {
  recovery?: { mode: 'exact-native'; slots: Array<Pick<ExecutionNativeRecoverySnapshotV1, 'slotId' | 'role' | 'personaId' | 'profileId' | 'nativeConversationId'>> };
  slotId: string;
  role: 'worker' | 'orchestrator';
  personaId: string;
  profile: LaunchProfileId;
}) {
  if (input.recovery?.mode !== 'exact-native') return undefined;
  const snapshot = input.recovery.slots.find((candidate) =>
    candidate.slotId === input.slotId
    && candidate.role === input.role
    && candidate.personaId === input.personaId
    && candidate.profileId === input.profile
  );
  if (!snapshot) return undefined;
  return registrationFor(input.profile)?.nativeConversationResume?.(snapshot.nativeConversationId);
}

/** Aggregate only: native ids stay in main while board UI learns current support. */
export function exactNativeRecoveryAvailability(input: {
  snapshots: ReadonlyArray<Pick<ExecutionNativeRecoverySnapshotV1, 'slotId' | 'role' | 'personaId' | 'profileId' | 'nativeConversationId'>>;
  slots: ReadonlyArray<{ slotId: string; role: 'worker' | 'orchestrator'; personaId: string; profile: LaunchProfileId }>;
}): { available: boolean; restorableSlots: number } {
  const restorableSlots = compatibleNativeRecoverySnapshots(input).length;
  return { available: restorableSlots > 0, restorableSlots };
}

/** Main-only exact-native candidates fenced against the current Team slot identity. */
export function compatibleNativeRecoverySnapshots<T extends Pick<ExecutionNativeRecoverySnapshotV1, 'slotId' | 'role' | 'personaId' | 'profileId' | 'nativeConversationId'>>(input: {
  snapshots: ReadonlyArray<T>;
  slots: ReadonlyArray<{ slotId: string; role: 'worker' | 'orchestrator'; personaId: string; profile: LaunchProfileId }>;
}): T[] {
  return input.snapshots.filter((snapshot) => input.slots.some((slot) => nativeRecoveryProjection({
    recovery: { mode: 'exact-native', slots: [snapshot] },
    slotId: slot.slotId,
    role: slot.role,
    personaId: slot.personaId,
    profile: slot.profile
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
