import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cleanupTmuxEnvironment, isolateTmuxEnvironment } from '../e2e/fixtures/tmux-isolation.js';

const homes: string[] = [];
const tmuxAvailable = spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status === 0;
function home() {
  const path = mkdtempSync(join(tmpdir(), 'zcc-tmux-test-'));
  homes.push(path);
  return path;
}
afterEach(async () => {
  for (const path of homes.splice(0)) {
    await cleanupTmuxEnvironment(path);
    rmSync(path, { recursive: true, force: true });
  }
});

it('pins a private server across app restarts even when HOME is preserved', async () => {
  const path = home();
  const inherited = { HOME: '/real/home', TMUX_TMPDIR: '/real/tmp', TMUX: '/real/socket,1,1', TMUX_PANE: '%1', PATH: process.env.PATH };
  const first = isolateTmuxEnvironment(path, inherited);
  expect(first.HOME).toBe('/real/home');
  expect(first.TMUX).toBeUndefined();
  expect(first.TMUX_PANE).toBeUndefined();
  expect(first.TMUX_TMPDIR).not.toBe(inherited.TMUX_TMPDIR);
  expect(statSync(first.TMUX_TMPDIR!).mode & 0o777).toBe(0o700);
  expect(isolateTmuxEnvironment(path, inherited).TMUX_TMPDIR).toBe(first.TMUX_TMPDIR);
  expect(inherited.TMUX).toBe('/real/socket,1,1');
  await cleanupTmuxEnvironment(path);
  expect(existsSync(first.TMUX_TMPDIR!)).toBe(false);
  await cleanupTmuxEnvironment(path); // no socket fallback when already cleaned
  expect(isolateTmuxEnvironment(path, inherited).TMUX_TMPDIR).not.toBe(first.TMUX_TMPDIR);
});

it.skipIf(process.platform === 'win32' || !tmuxAvailable)('one real tmux reaper and cleanup cannot see or stop another app’s worker', async () => {
  const a = home(); const b = home();
  const envA = isolateTmuxEnvironment(a, process.env);
  const envB = isolateTmuxEnvironment(b, process.env);
  const tmux = (env: NodeJS.ProcessEnv, ...args: string[]) => execFileSync('tmux', args, {
    env, encoding: 'utf8', timeout: 3_000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  // Same name in separate servers, matching the product's cc-* reaper scope.
  tmux(envA, '-f', '/dev/null', 'new-session', '-d', '-s', 'cc-worker', 'sleep', '60');
  tmux(envB, '-f', '/dev/null', 'new-session', '-d', '-s', 'cc-worker', 'sleep', '60');
  const serverA = tmux(envA, 'display-message', '-p', '#{pid}');
  expect(tmux(envB, 'display-message', '-p', '#{pid}')).not.toBe(serverA);
  tmux(envB, 'kill-session', '-t', 'cc-worker');
  expect(tmux(envA, 'list-sessions', '-F', '#{session_name}')).toBe('cc-worker');
  await cleanupTmuxEnvironment(b);
  expect(tmux(envA, 'display-message', '-p', '#{pid}')).toBe(serverA);
  await cleanupTmuxEnvironment(a);
  expect(existsSync(envA.TMUX_TMPDIR!)).toBe(false);
});
