import type { AppConfig, SquadTransport } from '@zana-ai/zcc-domain/product';
import {
  resolveSquadTransport,
  isLaunchMode,
  type SquadLaunchContext,
  type SquadTransportResolution,
  type SquadTransportSource
} from '@zana-ai/zcc-domain/squad-transport';

/** Run-level transport decision, pinned once per launch request in main. */
export interface PinnedTransport {
  transport: SquadTransport;
  source: SquadTransportSource;
  fallbackReason?: string;
}

const PIN_CAP = 256;

/** Bounded FIFO map of launchRequestId -> pinned transport. */
export class TransportPins {
  private readonly pins = new Map<string, PinnedTransport>();

  get(key: string | undefined): PinnedTransport | undefined {
    return key ? this.pins.get(key) : undefined;
  }

  set(key: string, pin: PinnedTransport): void {
    this.pins.delete(key);
    this.pins.set(key, pin);
    while (this.pins.size > PIN_CAP) {
      const oldest = this.pins.keys().next().value;
      if (oldest === undefined) break;
      this.pins.delete(oldest);
    }
  }
}

export interface ResolveTeamTransportInput {
  team: { transport?: string; slots?: ReadonlyArray<{ startOnDemand?: boolean; freshContextPerUnit?: boolean }> } | undefined;
  config: Pick<AppConfig, 'squadDefaultTransport' | 'composerDefaultLaunchMode' | 'composerLastTransportMode'
    | 'composerShowCliAgent' | 'composerShowModern'>;
  project: { remote?: unknown } | undefined;
  /** Derived in main from the calling session. Never taken from a request. */
  callerTransport?: SquadTransport;
  source?: SquadLaunchContext['source'];
  /** Per-request launch picker choice (UI hint, validated by the resolver). */
  pick?: SquadTransport;
}

export function resolveTeamTransport(input: ResolveTeamTransportInput): SquadTransportResolution {
  const { config } = input;
  const mode = isLaunchMode(config.composerDefaultLaunchMode) ? config.composerDefaultLaunchMode : undefined;
  // An explicit Modern pin or pick keeps the launch path's own seat refusal, which names the seats.
  // Only an inherited Modern falls back to CLI because of seats.
  const explicitModern = input.team?.transport === 'MODERN' || input.pick === 'MODERN';
  const team = explicitModern && input.team ? { ...input.team, slots: undefined } : input.team;
  return resolveSquadTransport(
    team,
    {
      squadDefaultTransport: config.squadDefaultTransport,
      composerLastTransportMode: config.composerLastTransportMode
    },
    mode,
    {
      source: input.source ?? 'ui',
      ...(input.pick ? { pick: input.pick } : {}),
      ...(input.callerTransport ? { callerTransport: input.callerTransport } : {}),
      ...(input.project?.remote ? { modernBlockedReason: 'Modern Squads need a local Project' } : {}),
      surfaces: { showCliAgent: config.composerShowCliAgent, showModern: config.composerShowModern }
    }
  );
}

/** A copy of the team with the resolved transport written in, so downstream reads see one value. */
export function pinTeamTransport<T extends { transport?: SquadTransport | 'CALLER' }>(
  team: T,
  pin: PinnedTransport
): T & { transport: SquadTransport } {
  return { ...team, transport: pin.transport };
}

export function toPinned(resolution: SquadTransportResolution): PinnedTransport | undefined {
  if (!resolution.ok) return undefined;
  return {
    transport: resolution.transport,
    source: resolution.source,
    ...(resolution.fallbackReason ? { fallbackReason: resolution.fallbackReason } : {})
  };
}
