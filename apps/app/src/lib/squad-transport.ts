import type { SquadTransport, Team, TerminalSession } from '@zana-ai/zcc-domain/product';
import {
  resolveSquadTransport,
  SQUAD_TRANSPORT_LABELS,
  type SquadLaunchMode,
  type SquadTransportSource
} from '@zana-ai/zcc-domain/squad-transport';
import { useData } from '../store.js';
import { MODERN_SQUAD_THREAD_ORIGIN } from '@zana-ai/zcc-domain/squad-origin';
import type { FleetKind } from '../components/fleet-item.js';

/** Shared with the server; read-only display hint, never authority. */
export { MODERN_SQUAD_THREAD_ORIGIN };

/** Mirrors of the app config the resolver reads; main owns the real decision at launch. */
export interface SquadTransportDisplayConfig {
  squadDefaultTransport: 'follow' | 'caller' | SquadTransport;
  composerDefaultLaunchMode: SquadLaunchMode | null;
  composerLastTransportMode: 'agent' | 'thread' | null;
  composerShowCliAgent: boolean;
  composerShowModern: boolean;
}

export interface SquadTransportView {
  transport: SquadTransport;
  source: SquadTransportSource;
  label: string;
  fallbackReason?: string;
}

/**
 * What a Squad would launch as from a surface with no calling agent (the app). Display only: the same
 * resolver runs in main at launch and its answer is the one that counts. A refused pin shows the pin.
 */
export function resolveSquadTransportView(
  team: (Pick<Team, 'transport'> & Partial<Pick<Team, 'slots'>>) | null | undefined,
  config: SquadTransportDisplayConfig,
  opts: { remote?: boolean; pick?: SquadTransport } = {}
): SquadTransportView {
  const resolution = resolveSquadTransport(
    team ?? undefined,
    {
      squadDefaultTransport: config.squadDefaultTransport,
      composerLastTransportMode: config.composerLastTransportMode ?? undefined
    },
    config.composerDefaultLaunchMode ?? undefined,
    {
      source: 'ui',
      ...(opts.pick ? { pick: opts.pick } : {}),
      ...(opts.remote ? { modernBlockedReason: 'Modern Squads need a local Project' } : {}),
      surfaces: { showCliAgent: config.composerShowCliAgent, showModern: config.composerShowModern }
    }
  );
  if (!resolution.ok) {
    const transport = squadTransport(team);
    return { transport, source: resolution.source, label: SQUAD_TRANSPORT_LABELS[transport] };
  }
  return {
    transport: resolution.transport,
    source: resolution.source,
    label: SQUAD_TRANSPORT_LABELS[resolution.transport],
    ...(resolution.fallbackReason ? { fallbackReason: resolution.fallbackReason } : {})
  };
}

/** Live mirrors of the config the display resolver needs. */
export function useSquadTransportConfig(): SquadTransportDisplayConfig {
  const squadDefaultTransport = useData((s) => s.squadDefaultTransport);
  const composerDefaultLaunchMode = useData((s) => s.composerDefaultLaunchMode);
  const composerLastTransportMode = useData((s) => s.composerLastTransportMode);
  const composerShowCliAgent = useData((s) => s.composerShowCliAgent);
  const composerShowModern = useData((s) => s.composerShowModern);
  return { squadDefaultTransport, composerDefaultLaunchMode, composerLastTransportMode, composerShowCliAgent, composerShowModern };
}

/** Plain-language source for tooltips and the run header. */
export const SQUAD_TRANSPORT_SOURCE_TEXT: Readonly<Record<SquadTransportSource, string>> = {
  squad: 'Set on this Squad',
  'launch-picker': 'Chosen for this launch',
  caller: 'Follows the calling session',
  global: 'All Squads default',
  'launch-mode': 'Default launch mode',
  fallback: 'Fallback',
  'fallback-squad-mode': 'Fallback'
};

/** Explicit transport only. Absent or Use default reads as CLI here; use `resolveSquadTransportView` for the effective one. */
export function squadTransport(team: Pick<Team, 'transport'> | null | undefined): SquadTransport {
  return team?.transport === 'MODERN' ? 'MODERN' : 'CLI';
}

/** Modern squads run ACP conversation threads; CLI squads run CLI agents. */
export function squadTransportKind(transport: SquadTransport): Extract<FleetKind, 'agent' | 'thread'> {
  return transport === 'MODERN' ? 'thread' : 'agent';
}

/** Modifier for squad member surfaces; Modern members get a dotted border. */
export function squadTransportClass(transport: SquadTransport): string {
  return transport === 'MODERN' ? 'is-modern' : '';
}

/** Plain-language name for the dotted Modern marker, so it never relies on the outline alone. */
export const MODERN_SQUAD_MEMBER_LABEL = 'Modern squad member';

/** Appends the Modern marker explanation to a row tooltip or accessible name. */
export function withModernSquadLabel(text: string, modern: boolean, separator = ' · '): string {
  return modern ? `${text}${separator}${MODERN_SQUAD_MEMBER_LABEL}` : text;
}

export function isModernSquadThread(thread: { originPluginId?: string | null }): boolean {
  return thread.originPluginId === MODERN_SQUAD_THREAD_ORIGIN;
}

/**
 * Actual transport behind an agent row/card. A real `TerminalSession` is
 * always a CLI agent, even when it belongs to a squad. A Modern squad member
 * card (an ACP thread, `modern`) is always Modern, and a synthetic Job host
 * (no live PTY behind it, id `execution:*`) borrows its squad's transport,
 * since a Modern squad's Job has no CLI session at all.
 */
export function agentSessionTransport(
  session: Pick<TerminalSession, 'id' | 'cohort'>,
  teams: readonly Pick<Team, 'id' | 'transport'>[],
  synthetic = session.id.startsWith('execution:'),
  modern = false,
  pinned?: SquadTransport
): SquadTransport {
  if (modern) return 'MODERN';
  if (!synthetic) return 'CLI';
  // The run's launch-time pin beats the Squad's current setting, which may have changed since.
  if (pinned) return pinned;
  const teamId = session.cohort?.teamId;
  return squadTransport(teamId ? teams.find((team) => team.id === teamId) : undefined);
}
