import type { Persona } from '@zana-ai/zcc-domain/product';

/**
 * Squad seat contract (#675): what a Squad seat on Codex or OpenCode gets from
 * its persona. Pure helpers only; PtyManager does the file and env work.
 */

/** A persona denylist entry a PATH shim can enforce: `Bash(<words>:*)` with a plain command name. */
export interface ShimmableEntry {
  /** The original persona entry, kept for messages. */
  readonly entry: string;
  /** Command name, matching `^[A-Za-z0-9._+-]+$`. */
  readonly command: string;
  /** Argument words that must follow the command for the entry to match (may be empty = any call). */
  readonly prefix: readonly string[];
}

/** A persona denylist entry a shim cannot express; it is listed in the seat's instructions instead. */
export interface AdvisoryEntry {
  readonly entry: string;
  readonly reason: string;
}

export interface ParsedDeniedEntries {
  readonly shimmable: readonly ShimmableEntry[];
  readonly advisory: readonly AdvisoryEntry[];
}

export interface SeatContractInput {
  readonly persona: Pick<Persona, 'appendSystemPrompt' | 'deniedTools'>;
  /** Harness command names the shim must never shadow. */
  readonly reservedCommands?: readonly string[];
}

export interface SeatShimFile {
  /** File name inside the per-session shim directory (the denied command name). */
  readonly name: string;
  readonly script: string;
}

export interface SeatContractPlan {
  /** Persona instructions plus the "not mechanically enforced" lines; empty when there is nothing to say. */
  readonly instructionsText: string;
  readonly shimFiles: readonly SeatShimFile[];
  readonly advisoryLines: readonly string[];
}

/** Split a persona's `deniedTools` into shim-enforceable and advisory entries (D3, D4). */
export function parseDeniedEntries(_deniedTools: readonly string[] | undefined): ParsedDeniedEntries {
  throw new Error('not implemented: parseDeniedEntries');
}

/** POSIX shell script for one denied command: refuse matching prefixes with exit 126, otherwise run the real binary (D3). */
export function buildShimScript(_command: string, _prefixes: readonly (readonly string[])[]): string {
  throw new Error('not implemented: buildShimScript');
}

/** Everything a seat needs from its persona: instructions text, shim files and advisory lines (D3, D4). */
export function planSeatContract(_input: SeatContractInput): SeatContractPlan {
  throw new Error('not implemented: planSeatContract');
}

/** Append the persona's text after the product guidance so the seat gets one guidance value (D2). */
export function foldPersonaIntoGuidance(_guidance: string, _persona: Pick<Persona, 'appendSystemPrompt'>): string {
  throw new Error('not implemented: foldPersonaIntoGuidance');
}
