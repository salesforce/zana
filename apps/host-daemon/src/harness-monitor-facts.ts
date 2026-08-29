import type { AgentState, LaunchProfileId } from '@zana-ai/zcc-domain/product';

export const HARNESS_MONITOR_FACTS_VERSION = 1;
export const MONITOR_FACT_TTL_MS = 30_000;
export const MONITOR_CLOCK_SKEW_MS = 5_000;

export type MonitorCapabilityState = 'supported' | 'unsupported' | 'temporarily-unavailable';
export type MonitorFactKind = 'process-exited' | 'blocked' | 'turn-active' | 'turn-finished' | 'tool-active' | 'visual';
export type MonitorResolutionReason =
  | 'invalid-fact'
  | 'unsupported'
  | 'temporarily-unavailable'
  | 'stale'
  | 'mis-correlated'
  | 'process-exited'
  | 'blocked'
  | 'active'
  | 'finished'
  | 'visual'
  | 'conflict'
  | 'insufficient-facts';

export interface HarnessMonitorFacts {
  version: number;
  sessionId: string;
  profile: LaunchProfileId;
  source: string;
  observedAt: number;
  capability: MonitorCapabilityState;
  kind?: MonitorFactKind;
  state?: AgentState;
  active?: boolean;
  processId?: number;
  processStartedAt?: number;
  sequence?: number;
  idempotencyKey?: string;
  reason?: string;
}

export interface MonitorResolution {
  state: AgentState;
  reason: MonitorResolutionReason;
}

const RANK: Record<MonitorFactKind, number> = {
  'process-exited': 5,
  blocked: 4,
  'tool-active': 3,
  'turn-active': 3,
  'turn-finished': 2,
  visual: 1
};

export function validateMonitorFact(fact: HarnessMonitorFacts, now: number): MonitorResolutionReason | null {
  if (fact.version !== HARNESS_MONITOR_FACTS_VERSION || !fact.sessionId || !fact.profile || !fact.source) {
    return 'invalid-fact';
  }
  if (!Number.isFinite(fact.observedAt) || fact.observedAt > now + MONITOR_CLOCK_SKEW_MS) return 'invalid-fact';
  if (fact.capability === 'unsupported') return 'unsupported';
  if (fact.capability === 'temporarily-unavailable') return 'temporarily-unavailable';
  if (!fact.kind || fact.observedAt < now - MONITOR_FACT_TTL_MS) return fact.kind ? 'stale' : 'insufficient-facts';
  if (fact.processId !== undefined && (!Number.isInteger(fact.processId) || !Number.isFinite(fact.processStartedAt))) {
    return 'invalid-fact';
  }
  return null;
}

/** Pure precedence resolver. Facts passed here must belong to one live session. */
export function resolveMonitorFacts(facts: readonly HarnessMonitorFacts[], now: number): MonitorResolution {
  const first = facts[0];
  if (first && facts.some((fact) => fact.sessionId !== first.sessionId || fact.profile !== first.profile)) {
    return { state: 'unknown', reason: 'mis-correlated' };
  }
  const usable = facts.flatMap((fact) => {
    const reason = validateMonitorFact(fact, now);
    return reason ? [] : [fact];
  });
  if (usable.length === 0) return { state: 'unknown', reason: 'insufficient-facts' };

  const highest = Math.max(...usable.map((fact) => RANK[fact.kind!]));
  const contenders = usable.filter((fact) => RANK[fact.kind!] === highest);
  const latest = Math.max(...contenders.map((fact) => fact.observedAt));
  const tied = contenders.filter((fact) => fact.observedAt === latest);
  const states = new Set(tied.map(stateForFact));
  if (states.size !== 1) return { state: 'unknown', reason: 'conflict' };
  const state = states.values().next().value as AgentState;
  const fact = tied[0];
  return {
    state,
    reason:
      fact.kind === 'process-exited'
        ? 'process-exited'
        : fact.kind === 'blocked'
          ? 'blocked'
          : fact.kind === 'turn-finished'
            ? 'finished'
            : fact.kind === 'visual'
              ? 'visual'
              : 'active'
  };
}

function stateForFact(fact: HarnessMonitorFacts): AgentState {
  if (fact.kind === 'process-exited') return 'done';
  if (fact.kind === 'blocked') return 'blocked';
  if (fact.kind === 'turn-finished') return 'idle';
  if (fact.kind === 'visual') return fact.state ?? 'unknown';
  return fact.active === false ? 'idle' : 'working';
}
