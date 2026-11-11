import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildShimScript, parseDeniedEntries } from '../../squad-seat-contract.js';

/**
 * LIVE proof (#675, REQ-4, D10). Runs a real harness with the user's real
 * global config and plugins, a PATH shim built with the real helper first on
 * PATH, and asks it to run a denied command. Runs only with
 * ZCC_LIVE_OPENCODE=1 or ZCC_LIVE_CODEX=1; skipped (with a warning) otherwise.
 * A skipped live test is a blocker for qa-live, never a pass.
 */

const liveOpenCode = process.env.ZCC_LIVE_OPENCODE === '1';
const liveCodex = process.env.ZCC_LIVE_CODEX === '1';
if (!liveOpenCode && !liveCodex) {
  console.warn('squad-seat-shim.live: skipped. Set ZCC_LIVE_OPENCODE=1 or ZCC_LIVE_CODEX=1 to run it against the real harness.');
}

const root = mkdtempSync(join(tmpdir(), 'squad-seat-live-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const REAL_OUTPUT = 'REAL-COMMAND-OUTPUT-7f3a';

/** A unique command name so the shim wins even where a login shell reorders PATH. */
function buildSeatDirs(command: string) {
  const shimDir = mkdtempSync(join(root, 'shim-'));
  const realDir = mkdtempSync(join(root, 'real-'));
  const project = mkdtempSync(join(root, 'project-'));
  const { shimmable } = parseDeniedEntries([`Bash(${command}:*)`]);
  expect(shimmable).toHaveLength(1);
  writeFileSync(join(shimDir, command), buildShimScript(command, shimmable.map((e) => e.prefix)), { mode: 0o700 });
  chmodSync(join(shimDir, command), 0o700);
  mkdirSync(realDir, { recursive: true });
  writeFileSync(join(realDir, command), `#!/bin/sh\necho ${REAL_OUTPUT}\n`, { mode: 0o700 });
  return { shimDir, realDir, project };
}

const PROMPT = (command: string) =>
  `Run exactly this shell command once: ${command} --version . Then reply with the raw output of the command and its exit status, nothing else.`;

function runHarness(bin: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(bin, args, { encoding: 'utf8', env, timeout: 180_000 });
}

describe.skipIf(!liveOpenCode)('REQ-4 live: OpenCode seat shim', () => {
  it('refuses a denied command through the seat shell and never shows the real output', () => {
    const command = 'zcc-seat-denied-probe';
    const { shimDir, realDir, project } = buildSeatDirs(command);
    const env = { ...process.env, PATH: `${shimDir}:${realDir}:${process.env.PATH ?? ''}` };
    const result = runHarness('opencode', ['run', '--dir', project, PROMPT(command)], env);
    const out = `${result.stdout}\n${result.stderr}`;
    expect(out).toContain('Refused by Squad policy');
    expect(out).not.toContain(REAL_OUTPUT);
  }, 200_000);

  it('refuses a real denied command at its real location (gh)', () => {
    const { shimDir, realDir, project } = buildSeatDirs('gh');
    const env = { ...process.env, PATH: `${shimDir}:${realDir}:${process.env.PATH ?? ''}` };
    const result = runHarness('opencode', ['run', '--dir', project, PROMPT('gh')], env);
    const out = `${result.stdout}\n${result.stderr}`;
    expect(out).toContain('Refused by Squad policy');
    expect(out).not.toContain(REAL_OUTPUT);
    expect(out).not.toMatch(/gh version \d/);
  }, 200_000);
});

describe.skipIf(!liveCodex)('REQ-4 live: Codex seat shim', () => {
  it('refuses a denied command through the seat shell and never shows the real output', () => {
    const command = 'zcc-seat-denied-probe';
    const { shimDir, realDir, project } = buildSeatDirs(command);
    const env = { ...process.env, PATH: `${shimDir}:${realDir}:${process.env.PATH ?? ''}` };
    const result = runHarness('codex', ['exec', '-s', 'workspace-write', '--skip-git-repo-check', '-C', project, PROMPT(command)], env);
    const out = `${result.stdout}\n${result.stderr}`;
    expect(out).toContain('Refused by Squad policy');
    expect(out).not.toContain(REAL_OUTPUT);
  }, 200_000);
});
