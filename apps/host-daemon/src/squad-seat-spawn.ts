import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { removeTreeWithoutFollowingLinks } from '@zana-ai/zcc-agent-process-utils';
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
  /** The harness command, so a shim can never shadow it. */
  readonly harnessCommand: string;
  /** Parent directory for the per-session root. Defaults to the temp directory. */
  readonly baseDir?: string;
}

/**
 * Build the seat's files, or return undefined when there is nothing to do: no
 * persona, a harness that enforces the persona natively, or a persona with neither
 * instructions nor denylist.
 */
export function prepareSeatSpawn(input: SeatSpawnInput): SeatSpawnPlan | undefined {
  const { capability, persona } = input;
  if (!persona || capability?.commandDeny === 'native') return undefined;
  const plan = planSeatContract({ persona, reservedCommands: [basename(input.harnessCommand)] });
  const wantsText = plan.instructionsText.length > 0 && capability?.instructions === true;
  if (!wantsText && plan.shimFiles.length === 0) return undefined;
  const foldIntoGuidance = wantsText && capability?.foldPersonaIntoGuidance === true;
  const needsFile = wantsText && !foldIntoGuidance;
  if (!needsFile && plan.shimFiles.length === 0) {
    return { instructionsText: plan.instructionsText, foldIntoGuidance, release() {} };
  }
  const root = mkdtempSync(join(input.baseDir ?? tmpdir(), 'zcc-seat-'));
  const release = () => {
    try {
      // Link-safe: a temp dir is cheap to leave behind, deleting through a link is not.
      removeTreeWithoutFollowingLinks(root);
    } catch {
      /* best-effort — a leftover dir is swept with the temp area */
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
