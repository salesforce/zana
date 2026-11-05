import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { removeTreeWithoutFollowingLinks, removeTreeWithoutFollowingLinksAsync } from '@zana-ai/zcc-agent-process-utils';
import type { Persona } from '@zana-ai/zcc-domain/product';
import type { SquadSeatCapability } from './harness/launch-provider.js';
import { planSeatContract } from './squad-seat-contract.js';

/**
 * File and directory work for a Squad seat (#675): the per-session shim directory
 * and the instructions file. PtyManager calls this only for a launch that carries
 * the seat marker, so every other launch runs today's code path.
 *
 * The shims are a guardrail for an agent that follows instructions, not a sandbox:
 * an absolute path such as /usr/bin/gh bypasses them.
 */

/** One Zana-owned parent for every seat root, so crash and quit orphans can be swept by age (Rules 3, 5). */
const SEAT_ROOTS_DIRNAME = 'zcc-squad-seats';
/** A live seat is far younger; a root older than this is an orphan of a crash or a quit that skipped the release. */
const SEAT_ROOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SEAT_SWEEP_MIN_INTERVAL_MS = 60_000;
let lastSeatSweepAt = 0;

/** Fire-and-forget age sweep of orphaned seat roots under `parent`; never blocks the spawn path. */
export function sweepStaleSeatRoots(parent: string, now = Date.now(), force = false): Promise<void> {
  if (!force && now - lastSeatSweepAt < SEAT_SWEEP_MIN_INTERVAL_MS) return Promise.resolve();
  lastSeatSweepAt = now;
  return (async () => {
    try {
      for (const name of await readdir(parent)) {
        if (!name.startsWith('zcc-seat-')) continue;
        const path = join(parent, name);
        try {
          if (now - (await stat(path)).mtimeMs > SEAT_ROOT_MAX_AGE_MS) await removeTreeWithoutFollowingLinksAsync(path);
        } catch (error) {
          console.warn(`[squad-seat] stale seat dir not removed: ${path}`, error);
        }
      }
    } catch {
      /* best-effort — the parent does not exist yet */
    }
  })();
}

export interface SeatSpawnPlan {
  /** Persona instructions plus the advisory lines; never empty on a returned plan with no shim dir. */
  readonly instructionsText: string;
  /** The harness takes the text inside its single guidance value. */
  readonly foldIntoGuidance: boolean;
  /** Per-session file holding the text, for a harness that reads instructions from a file. */
  readonly instructionsFile?: string;
  /** Per-session directory of shims; goes first on the seat's PATH. */
  readonly shimDir?: string;
  /** Remove everything this plan created. Safe to call twice. */
  release(): void;
}

export interface SeatSpawnInput {
  readonly capability: SquadSeatCapability | undefined;
  readonly persona: Pick<Persona, 'appendSystemPrompt' | 'deniedTools'> | undefined;
  /** The harness can never be a Squad seat; a spawn that reaches here anyway (restart, restore) fails closed. */
  readonly refusedForSquads?: boolean;
  /** The harness command, so a shim can never shadow it. */
  readonly harnessCommand: string;
  /** Parent directory for the per-session root. Defaults to a Zana-owned folder in the temp directory. */
  readonly baseDir?: string;
}

/**
 * Build the seat's files, or return undefined when there is nothing to do: no
 * persona, a harness that enforces the persona natively, or a persona with neither
 * instructions nor denylist. Shims are made only for a harness whose denylist is
 * `shim`; on any other harness the denies ride the instructions as advisory lines.
 * Throws when the contract has text the harness cannot carry (a persona edited after
 * launch reaching a restart or restore), so a seat never runs without its contract.
 */
export function prepareSeatSpawn(input: SeatSpawnInput): SeatSpawnPlan | undefined {
  const { capability, persona } = input;
  if (input.refusedForSquads) {
    throw new Error("Squad seat contract can't be delivered: this harness cannot run as a Squad seat. Choose another harness for this persona.");
  }
  if (!persona || capability?.commandDeny === 'native') return undefined;
  const plan = planSeatContract({
    persona,
    reservedCommands: [basename(input.harnessCommand)],
    enforceShims: capability?.commandDeny === 'shim'
  });
  if (plan.instructionsText.length > 0 && capability?.instructions !== true) {
    throw new Error("Squad seat contract can't be delivered: this harness cannot carry the persona instructions. Choose another harness for this persona.");
  }
  const wantsText = plan.instructionsText.length > 0;
  if (!wantsText && plan.shimFiles.length === 0) return undefined;
  const foldIntoGuidance = wantsText && capability?.foldPersonaIntoGuidance === true;
  const needsFile = wantsText && !foldIntoGuidance;
  if (!needsFile && plan.shimFiles.length === 0) {
    return { instructionsText: plan.instructionsText, foldIntoGuidance, release() {} };
  }
  const parent = input.baseDir ?? join(tmpdir(), SEAT_ROOTS_DIRNAME);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!input.baseDir) void sweepStaleSeatRoots(parent);
  const root = mkdtempSync(join(parent, 'zcc-seat-'));
  const release = () => {
    try {
      // Link-safe: a temp dir is cheap to leave behind, deleting through a link is not.
      removeTreeWithoutFollowingLinks(root);
    } catch (error) {
      // A leftover dir holds persona text; it is swept by age, but say so.
      console.warn(`[squad-seat] seat files not removed: ${root}`, error);
    }
  };
  try {
    let shimDir: string | undefined;
    if (plan.shimFiles.length > 0) {
      shimDir = join(root, 'bin');
      mkdirSync(shimDir, { mode: 0o700 });
      chmodSync(shimDir, 0o700);
      for (const shim of plan.shimFiles) {
        const path = join(shimDir, shim.name);
        writeFileSync(path, shim.script, { mode: 0o700 });
        chmodSync(path, 0o700);
      }
    }
    let instructionsFile: string | undefined;
    if (needsFile) {
      instructionsFile = join(root, 'instructions.md');
      writeFileSync(instructionsFile, plan.instructionsText, { mode: 0o600 });
    }
    return {
      instructionsText: plan.instructionsText,
      foldIntoGuidance,
      ...(instructionsFile ? { instructionsFile } : {}),
      ...(shimDir ? { shimDir } : {}),
      release
    };
  } catch (error) {
    release();
    throw error;
  }
}

/** Put the shim directory first on a PATH string. */
export function shimFirstPath(shimDir: string, path: string | undefined): string {
  return path ? `${shimDir}:${path}` : shimDir;
}
