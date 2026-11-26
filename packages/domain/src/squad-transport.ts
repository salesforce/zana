import type { SquadTransport } from './product.js';

/**
 * Single resolver for which transport a Squad launches on. Every launch site
 * (UI, MCP/agent, scheduler, proposals, recovery) must call this instead of
 * reading `team.transport` directly.
 *
 * Chain, highest first:
 *   Squad pin > launch picker > caller > Squad "Use default"
 *   > All Squads default > Default launch mode > CLI Agent
 */

export type SquadLaunchMode = 'agent' | 'thread' | 'team';

/** Mirrors the Composer default launch mode. Shared so main and renderer agree. */
export const DEFAULT_LAUNCH_MODE: SquadLaunchMode = 'thread';

/** `AppConfig.squadDefaultTransport`. A missing value reads as `caller`. */
export type GlobalSquadTransport = 'follow' | 'caller' | SquadTransport;
export const DEFAULT_GLOBAL_SQUAD_TRANSPORT: GlobalSquadTransport = 'caller';

/** `Team.transport`. Absent means "Use default". */
export type TeamTransportPref = SquadTransport | 'CALLER';

export type SquadTransportSource =
  | 'squad'
  | 'launch-picker'
  | 'caller'
  | 'global'
  | 'launch-mode'
  | 'fallback'
  | 'fallback-squad-mode';

export interface SquadTransportConfig {
  squadDefaultTransport?: GlobalSquadTransport;
  /** Last non-Team Composer mode (`agent` | `thread`). Team resolves through it. */
  composerLastTransportMode?: 'agent' | 'thread';
}

export interface SquadLaunchContext {
  source: 'ui' | 'agent' | 'scheduler';
  /** Per-request launch picker choice (UI only). */
  pick?: SquadTransport;
  /** Transport of the calling session, derived by main (never caller-supplied). */
  callerTransport?: SquadTransport;
  /** Why Modern cannot run here (e.g. remote Project). Absent means it can. */
  modernBlockedReason?: string;
  /** Composer surfaces currently offered. Hidden ones are not inherited. */
  surfaces?: { showCliAgent?: boolean; showModern?: boolean };
}

export type SquadTransportResolution =
  | { ok: true; transport: SquadTransport; source: SquadTransportSource; fallbackReason?: string }
  | { ok: false; source: 'squad' | 'launch-picker'; refusal: string };

export function isTeamTransportPref(value: unknown): value is TeamTransportPref {
  return value === 'CLI' || value === 'MODERN' || value === 'CALLER';
}

export function isGlobalSquadTransport(value: unknown): value is GlobalSquadTransport {
  return value === 'follow' || value === 'caller' || value === 'CLI' || value === 'MODERN';
}

export function isLaunchMode(value: unknown): value is SquadLaunchMode {
  return value === 'agent' || value === 'thread' || value === 'team';
}

function launchModeTransport(
  mode: SquadLaunchMode,
  lastTransportMode: 'agent' | 'thread' | undefined,
  surfaces: SquadLaunchContext['surfaces']
): SquadTransport {
  const effective = mode === 'team' ? (lastTransportMode ?? 'thread') : mode;
  let transport: SquadTransport = effective === 'agent' ? 'CLI' : 'MODERN';
  if (transport === 'MODERN' && surfaces?.showModern === false) transport = 'CLI';
  else if (transport === 'CLI' && surfaces?.showCliAgent === false) transport = 'MODERN';
  return transport;
}

/** Seat options only CLI Agent runs; a Squad using them cannot run as Modern. */
export const MODERN_INCOMPATIBLE_SEAT_REASON = 'This Squad uses on-demand or fresh-session seats, which need CLI Agent';

export function modernBlockedBySeats(
  team: { slots?: ReadonlyArray<{ startOnDemand?: boolean; freshContextPerUnit?: boolean }> } | undefined
): string | undefined {
  return team?.slots?.some((slot) => slot.startOnDemand === true || slot.freshContextPerUnit === true)
    ? MODERN_INCOMPATIBLE_SEAT_REASON
    : undefined;
}

export function resolveSquadTransport(
  team: { transport?: TeamTransportPref | string; slots?: ReadonlyArray<{ startOnDemand?: boolean; freshContextPerUnit?: boolean }> } | undefined,
  config: SquadTransportConfig,
  launchModePref: SquadLaunchMode | undefined,
  ctx: SquadLaunchContext
): SquadTransportResolution {
  const blocked = ctx.modernBlockedReason ?? modernBlockedBySeats(team);
  const pin = team?.transport === 'CLI' || team?.transport === 'MODERN' ? team.transport : undefined;

  // Explicit choices are honoured or refused, never silently downgraded.
  if (pin) {
    if (pin === 'MODERN' && blocked) {
      return { ok: false, source: 'squad', refusal: `This Squad is set to Modern, which cannot run here: ${blocked}` };
    }
    return { ok: true, transport: pin, source: 'squad' };
  }
  if (ctx.pick) {
    if (ctx.pick === 'MODERN' && blocked) {
      return { ok: false, source: 'launch-picker', refusal: `Modern cannot run here: ${blocked}` };
    }
    return { ok: true, transport: ctx.pick, source: 'launch-picker' };
  }

  // Inherited layers: Modern that cannot run falls back to CLI with a reason.
  const inherited = (transport: SquadTransport, source: SquadTransportSource): SquadTransportResolution => {
    if (transport === 'MODERN' && blocked) {
      return { ok: true, transport: 'CLI', source: 'fallback-squad-mode', fallbackReason: blocked };
    }
    return { ok: true, transport, source };
  };

  if (team?.transport === 'CALLER' && ctx.callerTransport) {
    return inherited(ctx.callerTransport, 'caller');
  }

  const global = config.squadDefaultTransport ?? DEFAULT_GLOBAL_SQUAD_TRANSPORT;
  if (global === 'CLI' || global === 'MODERN') return inherited(global, 'global');
  if (global === 'caller' && ctx.callerTransport) return inherited(ctx.callerTransport, 'caller');

  const mode = launchModePref ?? DEFAULT_LAUNCH_MODE;
  return inherited(
    launchModeTransport(mode, config.composerLastTransportMode, ctx.surfaces),
    'launch-mode'
  );
}

export const SQUAD_TRANSPORT_LABELS: Readonly<Record<SquadTransport, string>> = {
  CLI: 'CLI Agent',
  MODERN: 'Modern'
};

/** One wording for the All Squads setting's value, shared by Settings and settings search. */
export function squadDefaultTransportLabel(value: GlobalSquadTransport | undefined): string {
  const v = value ?? 'caller';
  return v === 'caller' ? 'Follow caller' : v === 'follow' ? 'Default launch mode' : v === 'MODERN' ? 'Modern' : 'CLI Agent';
}
