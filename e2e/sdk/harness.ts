/**
 * Fake agent-harness binaries for deterministic e2e specs.
 *
 * Generalizes the inline `STUB` shell script that used to live in
 * `agent-status-hydrate.spec.ts`. A spec points a launch profile's binary config
 * key (`claudeBinary` / `cursorBinary` / `codexBinary` / `piBinary`) at one of
 * these stubs so the app spawns a REAL pty running a controlled sequence — no
 * network, no real CLI, no flakiness.
 *
 * How agent state is driven: main's `AgentStatusTracker.classifyOscTitle`
 * (src/main/agent-status.ts) classifies ANY profile's OSC-2 title — a leading
 * braille glyph (U+2800–U+28FF) → `working`, a leading `✳` (U+2733) → `idle`,
 * anything else → no change. So:
 *   - profile 'claude'  emits those OSC titles (drives working/idle lanes),
 *   - profile 'generic' emits plain stdout (codex/pi/cursor shape — the tracker
 *     leaves OSC state untouched; they surface via activity heuristics instead).
 *
 * The octal escapes below are interpreted by the shell's `printf`, NOT by JS —
 * they must be the byte-exact sequence `extractLastOscTitle` parses. This is the
 * load-bearing detail; a wrong byte yields a title the classifier ignores.
 */
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type HarnessProfile = 'claude' | 'generic';

export type HarnessSequence =
  /** Braille spinner (working) then block forever. The classic "hold working" stub. */
  | 'working-hold'
  /** Work briefly, then settle to ✳ idle and hold — drives a working→idle transition. */
  | 'work-then-idle'
  /** Work briefly, then clean exit(code) — drives the onExit lifecycle. */
  | 'work-then-exit'
  /** Generic agent: plain stdout, no OSC title, hold forever. */
  | 'plain-hold'
  /** Generic agent: plain stdout, then exit(code). */
  | 'plain-exit';

export interface FakeAgentOptions {
  /** 'claude' → OSC titles; 'generic' → plain stdout. Defaults from `sequence`. */
  profile?: HarnessProfile;
  /** A named canned sequence. Ignored when `script` is provided. */
  sequence?: HarnessSequence;
  /** Fully custom shell body (sans shebang) — overrides the preset. */
  script?: string;
  /** Exit code for the *-exit sequences (default 0). */
  exitCode?: number;
  /** Idle title text after the working phase (work-then-idle, claude). */
  idleTitle?: string;
  /** Working title text (claude sequences). */
  workingTitle?: string;
}

export interface FakeAgentBinary {
  /** Absolute path to the executable stub — point a `*Binary` config key here. */
  path: string;
  /** The tmp dir holding it (call `cleanup()` or rm this in a spec's finally). */
  dir: string;
  /** Remove the tmp dir (best-effort). */
  cleanup(): void;
}

// U+2809 ⠉ braille "working" spinner glyph, as shell printf octal bytes.
const BRAILLE_WORKING = '\\342\\240\\211';
// U+2733 ✳ idle/done marker, as shell printf octal bytes.
const IDLE_MARK = '\\342\\234\\263';

/** Emit an OSC-2 title (`ESC ] 2 ; <title> BEL`) via printf, byte-exact. */
function oscTitle(title: string): string {
  return `printf '\\033]2;${title}\\007'`;
}

const HOLD = 'cat';

function presetBody(opts: FakeAgentOptions): string {
  const profile = opts.profile ?? 'claude';
  const seq = opts.sequence ?? (profile === 'claude' ? 'working-hold' : 'plain-hold');
  const working = opts.workingTitle ?? 'Cooking';
  const idle = opts.idleTitle ?? 'ready';
  const code = opts.exitCode ?? 0;

  const versionIntercept = 'if [ "$1" = "--version" ]; then echo "fake-agent-1.0.0"; exit 0; fi\n';

  switch (seq) {
    case 'working-hold':
      return `${versionIntercept}${oscTitle(`${BRAILLE_WORKING} ${working}`)}\n${HOLD}`;
    case 'work-then-idle':
      return [
        versionIntercept,
        oscTitle(`${BRAILLE_WORKING} ${working}`),
        'sleep 1',
        oscTitle(`${IDLE_MARK} ${idle}`),
        HOLD
      ].join('\n');
    case 'work-then-exit':
      return [versionIntercept, oscTitle(`${BRAILLE_WORKING} ${working}`), 'sleep 1', `exit ${code}`].join('\n');
    case 'plain-hold':
      return `${versionIntercept}echo "generic agent running"\n${HOLD}`;
    case 'plain-exit':
      return `${versionIntercept}echo "generic agent running"\nsleep 1\nexit ${code}`;
    default:
      return `${versionIntercept}${HOLD}`;
  }
}

/**
 * Write a chmod +x shell stub into a throwaway tmp dir and return its path.
 * Caller owns cleanup (call `.cleanup()` in a `finally`).
 */
export function makeFakeAgentBinary(opts: FakeAgentOptions = {}): FakeAgentBinary {
  const profile = opts.profile ?? 'claude';
  const body = opts.script ?? presetBody(opts);
  const dir = mkdtempSync(join(tmpdir(), 'zcc-fake-agent-'));
  const path = join(dir, `${profile}-stub.sh`);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return {
    path,
    dir,
    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  };
}
