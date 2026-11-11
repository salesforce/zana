import { chmodSync, lstatSync, mkdirSync, mkdtempSync, opendirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { removeTreeWithoutFollowingLinks } from '@zana-ai/zcc-agent-process-utils';
import type { Persona } from '@zana-ai/zcc-domain/product';
import type { SquadSeatCapability } from './harness/launch-provider.js';
import { planSeatContract } from './squad-seat-contract.js';
import { listLocalTmuxSessionIds } from './tmux.js';

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
/** Bound on roots examined per sweep (Rule 5); the next sweep continues. */
const SEAT_SWEEP_MAX_ENTRIES = 500;
const SEAT_OWNER_SESSION_FILE = '.owner-session-id';
let lastSeatSweepAt = 0;
let sweepInFlight: Promise<void> | undefined;
let lastSweepName: string | undefined;
/** Roots of seats this process still owns: the sweep never removes them, however old (a tmux seat can outlive 7 days). */
const liveSeatRoots = new Set<string>();

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

async function sweepOnce(parent: string, now: number): Promise<void> {
  try {
    const liveTmuxSessionIds = new Set(await listLocalTmuxSessionIds());
    let remaining = SEAT_SWEEP_MAX_ENTRIES;
    let lastProcessed: string | undefined;
    const processName = (name: string): boolean => {
      if (!name.startsWith('zcc-seat-')) return false;
      if (remaining <= 0) return true;
      remaining -= 1;
      lastProcessed = name;
      const path = join(parent, name);
      if (liveSeatRoots.has(path)) return false;
      const ownerSession = seatOwnerSessionId(path);
      if (ownerSession && liveTmuxSessionIds.has(ownerSession)) return false;
      try {
        if (now - statSync(path).mtimeMs > SEAT_ROOT_MAX_AGE_MS) removeTreeWithoutFollowingLinks(path);
      } catch (error) {
        console.warn(`[squad-seat] stale seat dir not removed: ${path}`, error);
      }
      return false;
    };
    const first = opendirSync(parent);
    let seenCursor = !lastSweepName;
    try {
      while (remaining > 0) {
        const entry = first.readSync();
        if (!entry) break;
        if (entry.name === lastSweepName) {
          seenCursor = true;
          continue;
        }
        if (!seenCursor) continue;
        if (processName(entry.name)) break;
      }
    } finally {
      first.closeSync();
    }
    if (remaining > 0 && lastSweepName) {
      const second = opendirSync(parent);
      try {
        while (remaining > 0) {
          const entry = second.readSync();
          if (!entry || (seenCursor && entry.name === lastSweepName)) break;
          if (processName(entry.name)) break;
        }
      } finally {
        second.closeSync();
      }
    }
    if (lastProcessed) lastSweepName = lastProcessed;
    else if (!seenCursor) lastSweepName = undefined;
  } catch (error) {
    // A missing parent is normal (nothing spawned yet); anything else (EACCES, ENOTDIR) is worth a line.
    if (!isNotFound(error)) console.warn(`[squad-seat] seat sweep failed for ${parent}`, error);
  }
}

function seatOwnerSessionId(root: string): string | undefined {
  try {
    const id = readFileSync(join(root, SEAT_OWNER_SESSION_FILE), 'utf8').trim();
    return id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Fire-and-forget age sweep of orphaned seat roots under `parent`; throttled, never overlapping, never blocks the spawn path. */
export function sweepStaleSeatRoots(parent: string, now = Date.now(), force = false): Promise<void> {
  if (sweepInFlight) return sweepInFlight;
  if (!force && now - lastSeatSweepAt < SEAT_SWEEP_MIN_INTERVAL_MS) return Promise.resolve();
  lastSeatSweepAt = now;
  const run = sweepOnce(parent, now).finally(() => { sweepInFlight = undefined; });
  sweepInFlight = run;
  return run;
}

/**
 * The Zana-owned parent for seat roots, or undefined when it cannot be trusted (Rule 2). On a shared
 * /tmp another user may have created it first: it must be a real directory owned by this user, and is
 * tightened to 0700. The caller then falls back to a private mkdtemp directly in the temp directory.
 */
export function trustedSeatParent(parent: string): string | undefined {
  try {
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const info = lstatSync(parent);
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    if (!info.isDirectory() || info.isSymbolicLink() || (uid !== undefined && info.uid !== uid)) {
      console.warn(`[squad-seat] ${parent} is not a directory owned by this user; using a private temp dir instead`);
      return undefined;
    }
    if ((info.mode & 0o077) !== 0) chmodSync(parent, 0o700);
    return parent;
  } catch (error) {
    console.warn(`[squad-seat] ${parent} cannot be prepared; using a private temp dir instead`, error);
    return undefined;
  }
}

/** Throw unless a remote Squad seat has nothing to deliver: seat files are host-local and createRemote carries no contract (F10). */
export function assertRemoteSeatContract(input: Pick<SeatSpawnInput, 'capability' | 'persona' | 'refusedForSquads'>): void {
  if (input.refusedForSquads) throw new Error(REFUSED_MESSAGE);
  if (!input.persona || input.capability?.commandDeny === 'native') return;
  const plan = planSeatContract({ persona: input.persona, enforceShims: false });
  if (plan.instructionsText.length > 0) {
    throw new Error("Squad seat contract can't be delivered: it cannot be carried to a remote project on this harness. Choose another harness for this persona.");
  }
}

const REFUSED_MESSAGE = "Squad seat contract can't be delivered: this harness cannot run as a Squad seat. Choose another harness for this persona.";

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
  /** Owning session id, written into the seat root so restart sweeps can spare reattached tmux sessions. */
  readonly sessionId?: string;
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
  if (input.refusedForSquads) throw new Error(REFUSED_MESSAGE);
  if (!persona || capability?.commandDeny === 'native') return undefined;
  const plan = planSeatContract({
    persona,
    reservedCommands: [basename(input.harnessCommand)],
    enforceShims: capability?.commandDeny === 'shim'
  });
  const wantsText = plan.instructionsText.length > 0;
  if (wantsText && capability?.instructions !== true) {
    throw new Error("Squad seat contract can't be delivered: this harness cannot carry the persona instructions. Choose another harness for this persona.");
  }
  if (!wantsText && plan.shimFiles.length === 0) return undefined;
  const foldIntoGuidance = wantsText && capability?.foldPersonaIntoGuidance === true;
  const needsFile = wantsText && !foldIntoGuidance;
  if (!needsFile && plan.shimFiles.length === 0) {
    return { instructionsText: plan.instructionsText, foldIntoGuidance, release() {} };
  }
  return materialiseSeat(plan, foldIntoGuidance, needsFile, input.baseDir, input.sessionId);
}

/** Create the seat's root and write its shims and instructions file; removes the root again if any write fails. */
function materialiseSeat(
  plan: ReturnType<typeof planSeatContract>,
  foldIntoGuidance: boolean,
  needsFile: boolean,
  baseDir: string | undefined,
  sessionId: string | undefined
): SeatSpawnPlan {
  const defaultParent = baseDir === undefined ? trustedSeatParent(join(tmpdir(), SEAT_ROOTS_DIRNAME)) : undefined;
  if (defaultParent) void sweepStaleSeatRoots(defaultParent);
  const root = mkdtempSync(join(baseDir ?? defaultParent ?? tmpdir(), 'zcc-seat-'));
  liveSeatRoots.add(root);
  const release = () => {
    liveSeatRoots.delete(root);
    try {
      // Link-safe: a temp dir is cheap to leave behind, deleting through a link is not.
      removeTreeWithoutFollowingLinks(root);
    } catch (error) {
      // A leftover dir holds persona text; it is swept by age, but say so.
      console.warn(`[squad-seat] seat files not removed: ${root}`, error);
    }
  };
  try {
    const shimDir = plan.shimFiles.length > 0 ? writeShims(root, plan.shimFiles) : undefined;
    let instructionsFile: string | undefined;
    if (needsFile) {
      instructionsFile = join(root, 'instructions.md');
      writeFileSync(instructionsFile, plan.instructionsText, { mode: 0o600 });
    }
    if (sessionId) {
      writeFileSync(join(root, SEAT_OWNER_SESSION_FILE), sessionId, { mode: 0o600 });
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

function writeShims(root: string, shimFiles: ReturnType<typeof planSeatContract>['shimFiles']): string {
  const shimDir = join(root, 'bin');
  mkdirSync(shimDir, { mode: 0o700 });
  chmodSync(shimDir, 0o700);
  for (const shim of shimFiles) {
    const path = join(shimDir, shim.name);
    writeFileSync(path, shim.script, { mode: 0o700 });
    chmodSync(path, 0o700);
  }
  return shimDir;
}

/** Put the shim directory first on a PATH string. */
export function shimFirstPath(shimDir: string, path: string | undefined): string {
  return path ? `${shimDir}:${path}` : shimDir;
}
