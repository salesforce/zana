import type { SquadTransport, Team, TerminalSession } from '@zana-ai/zcc-domain/product';
import type { FleetKind } from '../components/fleet-item.js';

/**
 * Host-reserved origin stamped on every Modern squad member's conversation
 * thread (mirrors `MODERN_SQUAD_BINDING_ORIGIN` in the server's
 * squad-member-runtime). Read-only display hint: the renderer never writes it
 * and never treats it as authority.
 */
export const MODERN_SQUAD_THREAD_ORIGIN = 'host-modern-squad';

/** Absent persisted teams remain CLI. */
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
  modern = false
): SquadTransport {
  if (modern) return 'MODERN';
  if (!synthetic) return 'CLI';
  const teamId = session.cohort?.teamId;
  return squadTransport(teamId ? teams.find((team) => team.id === teamId) : undefined);
}
