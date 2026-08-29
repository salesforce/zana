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
 * braille glyph (U+2800–U+28FF) or `✻` (U+273B) → `working`, a leading `✳`
 * (U+2733) → `idle`,
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
  /** Exercise live notify + Stop lifecycle callbacks, then hold at the prompt. */
  | 'lifecycle-flow'
  /** Generic agent: plain stdout, no OSC title, hold forever. */
  | 'plain-hold'
  /** Generic agent: plain stdout, then exit(code). */
  | 'plain-exit'
  /**
   * Non-OSC agent that emits NO output at all, then holds forever. This is the
   * cross-harness "at rest, awaiting input" fixture: because the pty never
   * produces a first output event, main's output-activity heuristic
   * (`OutputActivityMonitor.onSilence`, src/main/output-activity.ts) sees
   * `!hasFirstEvent` after `DEFAULT_IDLE_AFTER_MS` (~1.5s) and reports `waiting`
   * (NOT `idle`, which requires prior output). Contrast `plain-hold`, which
   * echoes a line first and therefore settles to `idle`. Use for specs that must
   * observe the `waiting` agent state on a non-Claude harness.
   */
  | 'silent-hold';

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

/**
 * Deterministic OpenCode catalog for Electron tests. Exercises `agent list` and
 * `debug agent` without reading a developer's OpenCode configuration.
 */
export function makeFakeOpenCodeBinary(): FakeAgentBinary {
  return makeFakeAgentBinary({
    profile: 'generic',
    script: [
      'if [ "$1" = "--version" ]; then echo "1.18.10"; exit 0; fi',
      'if [ "$1" = "agent" ] && [ "$2" = "list" ]; then',
      '  echo "build (primary)"',
      '  echo "plan (primary)"',
      '  echo "hidden-system (primary)"',
      '  echo "worker (subagent)"',
      '  exit 0',
      'fi',
      'if [ "$1" = "debug" ] && [ "$2" = "agent" ]; then',
      '  if [ "$3" = "hidden-system" ]; then',
      '    echo "{\\"name\\":\\"hidden-system\\",\\"hidden\\":true,\\"permission\\":{\\"read\\":true}}"',
      '  else',
      '    echo "{\\"name\\":\\"$3\\",\\"permission\\":{\\"read\\":true},\\"tools\\":{\\"bash\\":true}}"',
      '  fi',
      '  exit 0',
      'fi',
      'echo "unexpected fake OpenCode invocation: $*" >&2',
      'exit 64'
    ].join('\n')
  });
}

/**
 * OpenCode fixture that satisfies the launch handshake (`--version` + agent
 * discovery) then holds with NO session output. A worker launched on this binary
 * receives its kickoff via `--prompt` argv (never stdin), so nothing is ever
 * written to or echoed by its pty — main's output-activity heuristic therefore
 * classifies it `waiting` (non-OSC harness at rest, `!hasFirstEvent`; the
 * `silent-hold` sequence documents the mechanism). Discovery output is captured
 * out-of-band by main and never reaches the session pty, so it doesn't count as a
 * first output event. Use for at-rest cross-harness delivery specs where a real
 * OpenCode worker must settle to `waiting`.
 */
export function makeSilentOpenCodeBinary(): FakeAgentBinary {
  return makeFakeAgentBinary({
    profile: 'generic',
    script: [
      'if [ "$1" = "--version" ]; then echo "1.18.10"; exit 0; fi',
      'if [ "$1" = "agent" ] && [ "$2" = "list" ]; then echo "build (primary)"; exit 0; fi',
      'if [ "$1" = "debug" ] && [ "$2" = "agent" ]; then echo \'{"hidden":false}\'; exit 0; fi',
      // Any other invocation (the worker/coordinator run) holds SILENTLY: no
      // stdout means the session never registers a first output event, so it
      // settles to `waiting` rather than `idle`.
      'cat'
    ].join('\n')
  });
}

/** OpenCode fixture whose catalog changes only after its marker file appears. */
export function makeRefreshableFakeOpenCodeBinary(): FakeAgentBinary & {
  refreshMarker: string;
  catalogCalls: string;
} {
  const binary = makeFakeAgentBinary({
    profile: 'generic',
    script: [
      'ROOT=$(dirname "$0")',
      'if [ "$1" = "--version" ]; then echo "1.18.10"; exit 0; fi',
      'if [ "$1" = "agent" ] && [ "$2" = "list" ]; then',
      '  printf "%s\\n" "$*" >> "$ROOT/catalog-calls"',
      '  echo "build (primary)"',
      '  if [ -f "$ROOT/refresh-marker" ]; then echo "review (primary)"; else echo "plan (primary)"; fi',
      '  exit 0',
      'fi',
      'if [ "$1" = "debug" ] && [ "$2" = "agent" ]; then',
      '  echo "{\\"name\\":\\"$3\\",\\"permission\\":{\\"read\\":true}}"',
      '  exit 0',
      'fi',
      'exit 64'
    ].join('\n')
  });
  return {
    ...binary,
    refreshMarker: join(binary.dir, 'refresh-marker'),
    catalogCalls: join(binary.dir, 'catalog-calls')
  };
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
    case 'lifecycle-flow':
      return [
        versionIntercept,
        // Fail loudly if the launcher's callback wiring regresses. The test then
        // calls the same local HTTP routes Claude's configured hooks use.
        '[ -n "$ZCC_HOOK_URL" ] && [ -n "$ZCC_NOTIFY_URL" ] || exit 90',
        oscTitle(`✻ ${working}`),
        'sleep 1',
        'curl -s -m 5 -X POST "$ZCC_NOTIFY_URL/blocked" >/dev/null',
        'sleep 1',
        'curl -s -m 5 -X POST "$ZCC_NOTIFY_URL/unblocked" >/dev/null',
        'sleep 1',
        'curl -s -m 5 -X POST "$ZCC_HOOK_URL" >/dev/null',
        HOLD
      ].join('\n');
    case 'plain-hold':
      return `${versionIntercept}echo "generic agent running"\n${HOLD}`;
    case 'plain-exit':
      return `${versionIntercept}echo "generic agent running"\nsleep 1\nexit ${code}`;
    case 'silent-hold':
      // No echo, no OSC title — just hold. Drives the silence heuristic to
      // `waiting` (see the sequence doc above).
      return `${versionIntercept}${HOLD}`;
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
