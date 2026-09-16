/**
 * Hydrate exited CLI Agent cards from the restore-capabilities ledger.
 * Read-only: never spawns. Tmux survivors stay on the reattach path.
 */

import type { LaunchProfileId, TerminalSession, CreateTerminalRequest } from '@zana-ai/zcc-domain/product';
import { extractPinnedSessionId } from '@zana-ai/zcc-spawn-plan';
import type { RestoreCapability } from '@zana-ai/zcc-server/services/launch/restore-capability-store';
import { nativeSessionFields } from './harness/session-adapter.js';
import { registrationFor } from './harness/registry.js';

export interface RememberedFilterContext {
  liveTmuxIds: ReadonlySet<string>;
  livePtyIds: ReadonlySet<string>;
  knownProjectIds: ReadonlySet<string>;
}

export function isRememberedCapability(
  capability: RestoreCapability,
  ctx: RememberedFilterContext
): boolean {
  const request = capability.request as CreateTerminalRequest;
  if (!request?.projectId || !ctx.knownProjectIds.has(request.projectId)) return false;
  if (request.scheduled) return false;
  if (request.headless && request.cohort?.role !== 'worker') return false;
  const profile = capability.sessionProfile ?? request.profile;
  if (profile === 'shell') return false;
  const sessionId = capability.sessionId;
  if (sessionId && ctx.livePtyIds.has(sessionId)) return false;
  if (sessionId && ctx.liveTmuxIds.has(sessionId)) return false;
  return true;
}

export function tombstoneFromCapability(capability: RestoreCapability): TerminalSession {
  const request = capability.request as CreateTerminalRequest;
  const profile = (capability.sessionProfile ?? request.profile) as LaunchProfileId;
  const nativeId =
    request.resumeSessionId ?? extractPinnedSessionId(request.extraArgs ?? []);
  const patch = nativeId ? registrationFor(profile)?.nativeSessionPatch?.(nativeId) : undefined;
  const nativeFields = nativeSessionFields(patch);
  const claudeSessionId =
    nativeFields.nativeConversationId || nativeFields.codexSessionId || nativeFields.openCodeSessionId
      ? undefined
      : nativeId;
  return {
    id: capability.sessionId ?? capability.id,
    restoreCapabilityId: capability.id,
    projectId: request.projectId,
    title: capability.sessionTitle ?? request.title ?? profile,
    profile,
    cwd: request.cwd ?? '',
    status: 'exited',
    createdAt: capability.createdAt,
    finishedAt: capability.exitedAt ?? capability.createdAt,
    extraArgs: request.extraArgs,
    remembered: true,
    claudeSessionId,
    ...nativeFields,
    headless: request.headless || undefined,
    scheduled: request.scheduled || undefined,
    personaId: request.personaId,
    cohort: request.cohort,
    remoteTmuxId: capability.remoteTmuxId
  };
}

export function listRememberedTombstones(
  entries: readonly RestoreCapability[],
  ctx: RememberedFilterContext
): TerminalSession[] {
  return entries.filter((entry) => isRememberedCapability(entry, ctx)).map(tombstoneFromCapability);
}
