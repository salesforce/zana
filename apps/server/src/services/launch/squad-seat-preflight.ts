import type { SquadSeatCapability } from '@zana-ai/zcc-host-daemon/harness/launch-provider';

/**
 * Whole-team preflight for Squad seats (#675, D6). Pure: run once before the
 * first spawn on the CLI path, so a refused launch creates no PTY and no claim.
 */

export type SquadCoordination = 'job-team' | 'structured' | 'freeform' | 'interactive-team' | string;

export interface SquadSeatCheckSeat {
  readonly slotId: string;
  /** Name shown to the user for this seat. */
  readonly label: string;
  /** Harness name shown to the user. */
  readonly harnessLabel: string;
  /** The harness's declared seat capability; absent means nothing is supported. */
  readonly capability?: SquadSeatCapability;
  /** The persona has an `appendSystemPrompt`. */
  readonly hasInstructions: boolean;
  /** The persona has denylist entries a PATH shim can enforce. */
  readonly hasShimmableDenies: boolean;
  /** The harness delivers no guidance on a remote project (Codex today). */
  readonly remoteGuidanceUnavailable?: boolean;
}

export interface SquadSeatCheckInput {
  readonly seats: readonly SquadSeatCheckSeat[];
  /** Coordination mode of the launch; durable modes need the execution tools. */
  readonly coordinationMode: SquadCoordination | undefined;
  readonly remoteProject: boolean;
  readonly platform: NodeJS.Platform;
}

export type SquadSeatCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly refusedSlotIds: readonly string[] };

const NOTHING: SquadSeatCapability = {
  instructions: false,
  commandDeny: 'none',
  executionTools: false,
  foldPersonaIntoGuidance: false
};

/** Durable coordination hands work out through the zcc-inbox execution tools. */
const DURABLE_MODES = new Set<string>(['job-team', 'structured', 'freeform']);

/** What a seat's harness cannot do for its persona; empty when the seat can run. */
function missingCapabilities(seat: SquadSeatCheckSeat, input: SquadSeatCheckInput): string[] {
  const capability = seat.capability ?? NOTHING;
  const missing: string[] = [];
  if (input.coordinationMode !== undefined && DURABLE_MODES.has(input.coordinationMode) && !capability.executionTools) {
    missing.push('it cannot reach the execution tools');
  }
  if (seat.hasInstructions) {
    if (!capability.instructions) missing.push('it cannot carry the persona instructions');
    else if (input.remoteProject && seat.remoteGuidanceUnavailable) {
      missing.push('it cannot carry the persona instructions on a remote project');
    }
  }
  if (seat.hasShimmableDenies) {
    if (capability.commandDeny === 'none') missing.push('its command denylist cannot be enforced');
    else if (capability.commandDeny === 'shim' && (input.remoteProject || input.platform === 'win32')) {
      missing.push(`its command denylist cannot be enforced ${input.remoteProject ? 'on a remote project' : 'on Windows'}`);
    }
  }
  return missing;
}

/** Check every seat against its harness; one refusal names every refused seat (D6). */
export function checkSquadSeats(input: SquadSeatCheckInput): SquadSeatCheckResult {
  const refused: { slotId: string; text: string }[] = [];
  for (const seat of input.seats) {
    const missing = missingCapabilities(seat, input);
    if (missing.length > 0) {
      refused.push({ slotId: seat.slotId, text: `Seat ${seat.label} can't run on ${seat.harnessLabel}: ${missing.join('; ')}.` });
    }
  }
  if (refused.length === 0) return { ok: true };
  return {
    ok: false,
    message: `${refused.map((item) => item.text).join(' ')} Choose another harness for ${refused.length === 1 ? 'this persona' : 'these personas'}.`,
    refusedSlotIds: refused.map((item) => item.slotId)
  };
}
