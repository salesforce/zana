import { sanitizeTeamLimits } from '@zana-ai/zcc-domain/product';
import type { ExecutionPolicyV1 } from './store.js';

/**
 * Apply a saved Squad's run limits to a launch policy as a CEILING: a caller (an agent, a
 * schedule) may ask for a tighter run, never a wider one. Limits are re-sanitized here, so a stale
 * or hand-edited value cannot widen a run. Absent limits return the policy unchanged.
 */
export function clampPolicyToSquadLimits<P extends Pick<ExecutionPolicyV1, 'maxConcurrent' | 'maxClaimWallClockMs' | 'maxClaimStallMs' | 'maxClaimOutputOnlyMs'>>(
  policy: P | undefined, rawLimits: unknown
): P | undefined {
  const limits = sanitizeTeamLimits(rawLimits);
  if (!limits) return policy;
  const cap = (requested: number | undefined, ceiling: number | undefined) =>
    ceiling === undefined ? requested : Math.min(requested ?? ceiling, ceiling);
  const maxConcurrent = cap(policy?.maxConcurrent, limits.maxConcurrent);
  const maxClaimWallClockMs = cap(policy?.maxClaimWallClockMs, limits.claimWallClockMs);
  const maxClaimStallMs = cap(policy?.maxClaimStallMs, limits.claimStallMs);
  const maxClaimOutputOnlyMs = cap(policy?.maxClaimOutputOnlyMs, limits.claimOutputCeilingMs);
  return {
    ...policy,
    ...(maxConcurrent === undefined ? {} : { maxConcurrent }),
    ...(maxClaimWallClockMs === undefined ? {} : { maxClaimWallClockMs }),
    ...(maxClaimStallMs === undefined ? {} : { maxClaimStallMs }),
    ...(maxClaimOutputOnlyMs === undefined ? {} : { maxClaimOutputOnlyMs })
  } as P;
}

/** The effective concurrent-launch ceiling for a Squad launch: the requested value, capped by the Squad's saved limit. */
export function squadConcurrentCap(requested: number, rawLimits: unknown): number {
  const saved = sanitizeTeamLimits(rawLimits)?.maxConcurrent;
  return saved === undefined ? requested : Math.min(requested, saved);
}

/**
 * Wrap an execution service so `start` applies the saved limits of the Squad named by the request.
 * Every other member is passed through bound to the real service. Used for agent-driven
 * `execution.start`, which names a saved Squad but supplies its own policy.
 */
export function withSquadLimits<S extends object & { start: (callerPrincipalId: string, projectId: string, request: any, opts?: any) => Promise<any> }>(
  service: S, teamLimits: (teamId: string) => unknown
): S {
  return new Proxy(service, {
    get(target, prop) {
      if (prop === 'start') {
        return async (callerPrincipalId: string, projectId: string, request: { teamId?: string; policy?: ExecutionPolicyV1 }, opts?: unknown) => {
          const teamId = typeof request?.teamId === 'string' ? request.teamId : undefined;
          // async: a throwing lookup rejects the promise (fail closed: never launch wider than the Squad allows).
          const policy = teamId === undefined ? request?.policy : clampPolicyToSquadLimits(request?.policy, teamLimits(teamId));
          return target.start(callerPrincipalId, projectId, policy === request?.policy ? request : { ...request, policy }, opts);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}
