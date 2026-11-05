import type { CreateTerminalRequest, LaunchProfileId, Persona, Project } from '@zana-ai/zcc-domain/product';
import { providerFor } from '@zana-ai/zcc-host-daemon/harness/registry';
import { parseDeniedEntries } from '@zana-ai/zcc-host-daemon/squad-seat-contract';
import { checkSquadSeats, type SquadSeatCheckSeat } from '@zana-ai/zcc-server/services/launch/squad-seat-preflight';

/**
 * Main-side glue for the Squad seat contract (#675). Kept out of host.ts so the
 * branching is unit-tested here and host.ts stays one statement per call site.
 */

/** Spawn option that tells PtyManager a launch is a Squad seat. MAIN-only, never from a renderer request. */
export const SQUAD_SEAT_MARKER = { squadSeat: true as const };

export interface SquadSeatRefusal {
  readonly ok: false;
  readonly code: 'UNSUPPORTED';
  readonly message: string;
}

export interface SquadSeatPreflightInput {
  /** The Modern transport has its own refusals and is never checked here (REQ-14). */
  readonly transport: string | undefined;
  readonly expectedSlots: readonly { slotId: string; personaId: string }[];
  readonly personas: readonly Persona[];
  readonly profileFor: (personaId: string) => LaunchProfileId;
  readonly personaName: (personaId: string) => string;
  readonly coordinationMode: string | undefined;
  readonly project: Pick<Project, 'remote'>;
  readonly platform: NodeJS.Platform;
  /** Releases the request's preissued authorizations when the launch is refused. */
  readonly revoke: () => void;
}

/**
 * Run the whole-team seat check once, before the first spawn. Returns the finished
 * refusal `Result` (after revoking the request authorizations) or undefined when every seat can run.
 */
export function squadSeatRefusal(input: SquadSeatPreflightInput): SquadSeatRefusal | undefined {
  if (input.transport === 'MODERN') return undefined;
  const seats: SquadSeatCheckSeat[] = input.expectedSlots.map((slot) => {
    const profile = input.profileFor(slot.personaId);
    const provider = providerFor(profile);
    const persona = input.personas.find((candidate) => candidate.id === slot.personaId);
    const capability = provider.squadSeat;
    return {
      slotId: slot.slotId,
      label: input.personaName(slot.personaId),
      harnessLabel: provider.title(profile),
      capability,
      hasInstructions: Boolean(persona?.appendSystemPrompt?.trim()),
      hasShimmableDenies: parseDeniedEntries(persona?.deniedTools).shimmable.length > 0,
      // Only a harness that carries the persona natively in its argv delivers it to a remote box;
      // a folded guidance value or a host-local instructions file does not travel.
      remoteGuidanceUnavailable: capability?.commandDeny !== 'native'
    };
  });
  const checked = checkSquadSeats({
    seats,
    coordinationMode: input.coordinationMode,
    remoteProject: Boolean(input.project.remote),
    platform: input.platform
  });
  if (checked.ok) return undefined;
  input.revoke();
  return { ok: false, code: 'UNSUPPORTED', message: checked.message };
}

/** The marker for a restored or restarted terminal: a Squad seat has a team cohort and is not an orchestrator-child. */
export function squadSeatMarkerFor(request: Pick<CreateTerminalRequest, 'cohort'>): { squadSeat: true } | Record<string, never> {
  const cohort = request.cohort;
  if (!cohort || cohort.slotId?.startsWith('orchestrator-child:')) return {};
  return SQUAD_SEAT_MARKER;
}

/** Restore spawn options plus the seat marker; stays undefined when there is neither (today's behaviour). */
export function restoreSpawnOptions<T extends object>(
  base: T | undefined,
  request: Pick<CreateTerminalRequest, 'cohort'>
): (T & { squadSeat?: true }) | undefined {
  const marker = squadSeatMarkerFor(request);
  if (!('squadSeat' in marker)) return base as (T & { squadSeat?: true }) | undefined;
  return { ...(base ?? ({} as T)), ...marker };
}
