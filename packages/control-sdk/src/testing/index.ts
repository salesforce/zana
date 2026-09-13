/**
 * Fake harness binaries for isolated / PATH-prepared live tests.
 *
 * Attach-mode (`Zcc.connect()`) cannot rewrite Electron's PATH after boot.
 * Point a launch profile's binary config key at one of these stubs, or start
 * the app with them already on PATH. `provider: "fake"` + `connect()` throws.
 *
 * Job Team coordinator fixtures stay in `e2e/sdk/harness.ts`.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type HarnessProfile = 'claude' | 'generic';

export type HarnessSequence =
  | 'working-hold'
  | 'work-then-idle'
  | 'work-then-exit'
  | 'plain-hold'
  | 'plain-exit';

export interface FakeAgentOptions {
  profile?: HarnessProfile;
  sequence?: HarnessSequence;
  script?: string;
  exitCode?: number;
  idleTitle?: string;
  workingTitle?: string;
}

export interface FakeAgentBinary {
  path: string;
  dir: string;
  cleanup(): void;
}

const BRAILLE_WORKING = '\\342\\240\\211';
const IDLE_MARK = '\\342\\234\\263';
const HOLD = 'cat';

function oscTitle(title: string): string {
  return `printf '\\033]2;${title}\\007'`;
}

function presetBody(opts: FakeAgentOptions): string {
  const profile = opts.profile ?? 'claude';
  const seq = opts.sequence ?? (profile === 'claude' ? 'working-hold' : 'plain-hold');
  const working = opts.workingTitle ?? 'Cooking';
  const idle = opts.idleTitle ?? 'ready';
  const code = opts.exitCode ?? 0;
  const versionIntercept = 'if [ "$1" = "--version" ]; then echo "2.1.220 (Claude Code)"; exit 0; fi\n';

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
      return `${versionIntercept}${oscTitle(`${BRAILLE_WORKING} ${working}`)}\nsleep 1\nexit ${code}`;
    case 'plain-hold':
      return `${versionIntercept}echo "generic agent running"\n${HOLD}`;
    case 'plain-exit':
      return `${versionIntercept}echo "generic agent running"\nsleep 1\nexit ${code}`;
    default:
      return `${versionIntercept}${HOLD}`;
  }
}

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

/**
 * Hold-forever stub for Cursor/Codex/Pi/OpenCode CLI Agent launches.
 * Answers `--version` and catalog probes, then holds.
 */
export function makeFakeGenericHoldBinary(version = '2026.09.02'): FakeAgentBinary {
  return makeFakeAgentBinary({
    profile: 'generic',
    script: [
      `if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi`,
      'if [ "$1" = "agent" ] && [ "$2" = "list" ]; then',
      '  echo "build (primary)"',
      '  echo "plan (primary)"',
      '  exit 0',
      'fi',
      'if [ "$1" = "debug" ] && [ "$2" = "agent" ]; then',
      '  echo "{\\"name\\":\\"$3\\",\\"permission\\":{\\"read\\":true},\\"tools\\":{\\"bash\\":true}}"',
      '  exit 0',
      'fi',
      'if [ "$1" = "--list-models" ] || [ "$1" = "app-server" ] || [ "$1" = "agent" ] || [ "$1" = "acp" ]; then exit 0; fi',
      'echo "generic agent running"',
      'cat'
    ].join('\n')
  });
}

/**
 * OpenCode catalog fixture. Unexpected spawn (including `--model` riding with
 * `--agent`) exits 64 — the nativeRolePinsModel regression contract.
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
      'has_agent=0',
      'has_model=0',
      'for arg in "$@"; do',
      '  if [ "$arg" = "--agent" ]; then has_agent=1; fi',
      '  if [ "$arg" = "--model" ]; then has_model=1; fi',
      'done',
      'if [ "$has_agent" = "1" ] && [ "$has_model" = "1" ]; then',
      '  echo "unexpected fake OpenCode invocation: $* (role XOR model)" >&2',
      '  exit 64',
      'fi',
      'echo "unexpected fake OpenCode invocation: $*" >&2',
      'exit 64'
    ].join('\n')
  });
}
