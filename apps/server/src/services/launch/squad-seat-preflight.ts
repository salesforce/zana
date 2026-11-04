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

/** Check every seat against its harness; one refusal names every refused seat (D6). */
export function checkSquadSeats(_input: SquadSeatCheckInput): SquadSeatCheckResult {
  throw new Error('not implemented: checkSquadSeats');
}
