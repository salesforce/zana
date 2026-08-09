/**
 * Regression test for the multi-window agent-status desync: a window opened (or
 * reloaded) AFTER an agent had already settled into working/blocked showed every
 * card stuck in the "Idle" lane. Root cause: `onAgentStatus` is edge-triggered,
 * and the renderer never seeded a fresh window from the one-shot
 * `agentStatusSnapshot()` IPC — so `useAgentStatus.byId` started empty and every
 * card read `unknown` → the Idle catch-all.
 *
 * This drives the REAL path end-to-end: point `claudeBinary` at a stub that
 * emits Claude's braille-spinner OSC title (classified `working` by
 * `classifyOscTitle`), spawn a `claude`-profile agent, confirm it lands in the
 * Working lane, then RELOAD the window. A reload remounts the renderer and
 * re-runs `store.init()` — the identical hydration path a freshly-opened
 * ("Open in new window") window takes. Before the fix the card collapsed into
 * Idle after reload; with the seed it stays in Working.
 */
import { test, expect, dismissConsentOverlays } from './fixtures/app';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A stub `claude` binary: set the OSC-2 title to a braille spinner (U+2809),
// which AgentStatusTracker.classifyOscTitle maps to `working`, then block so the
// pty stays alive (the session must remain non-exited to hold a live lane).
const STUB = `#!/bin/sh
printf '\\033]2;\\342\\240\\211 Cooking\\007'
# Keep the pty open and non-idle. sleep in a loop so the process never exits
# during the test window.
while true; do sleep 3600; done
`;

test('agent status survives a window reload (snapshot re-hydration)', async ({ app }) => {
  const { window } = app;

  // Write the stub claude binary into an isolated tmp dir and point config at it.
  const binDir = mkdtempSync(join(tmpdir(), 'zcc-stub-bin-'));
  const stubPath = join(binDir, 'claude-stub.sh');
  writeFileSync(stubPath, STUB);
  chmodSync(stubPath, 0o755);

  // A real, registered project to spawn the agent into. On macOS the app resolves
  // ~/.zcc via app.getPath('home') (ignores sandbox HOME), so this lands in the
  // real projects.json — removed in `finally`, same as project-rail-spawn.spec.
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-status-proj-'));
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    const proj = (res && 'ok' in res ? (res as any).value : res) as { id: string };
    return proj.id;
  }, projectDir);
  expect(projectId).toBeTruthy();

  let sessionId: string | null = null;
  try {
    // Point the claude profile at the stub binary.
    await window.evaluate(async (bin) => {
      await window.cc.config.set({ claudeBinary: bin });
    }, stubPath);

    // Spawn a `claude`-profile agent in the project. It emits the spinner title,
    // so main's AgentStatusTracker resolves it to `working` and pushes onAgentStatus.
    sessionId = await window.evaluate(async (pid) => {
      const res = await window.cc.terminals.create({
        projectId: pid,
        profile: 'claude',
        cols: 80,
        rows: 24,
        title: 'Status Probe'
      });
      const s = (res && 'ok' in res ? (res as any).value : res) as { id: string };
      return s.id;
    }, projectId);
    expect(sessionId).toBeTruthy();

    // Wait for main's tracker to debounce (~250ms) and settle the session into
    // `working`. Assert on the source-of-truth snapshot IPC that a NEW window
    // would seed from — this is exactly the state the seed must re-hydrate.
    await expect
      .poll(
        async () =>
          window.evaluate(async () => {
            const pairs = (await window.cc.terminals.agentStatusSnapshot()) as Array<
              [string, string]
            >;
            return pairs.some(([, state]) => state === 'working');
          }),
        { timeout: 15_000 }
      )
      .toBe(true);

    // --- The regression check: a reload remounts the renderer and re-runs
    // store.init() — the IDENTICAL hydration path a freshly-opened ("Open in new
    // window") window takes. It pulls the persisted project + live session, then
    // must seed agent state from the snapshot. Before the fix, `useAgentStatus`
    // started empty, every card read `unknown`, and the session collapsed into
    // the Idle lane. With the seed it re-hydrates as Working.
    await window.reload();
    await window.waitForSelector('#root', { timeout: 30_000 });
    await dismissConsentOverlays(window);

    // Navigate to the global Agents board (nav resets to home on reload).
    const agentsNav = window.locator('button.nav-item').filter({ hasText: 'Agents' });
    await agentsNav.first().click();

    const workingLane = window.locator('.agents-lane.lane-working');
    const idleLane = window.locator('.agents-lane.lane-idle');

    // The seeded state lands the card in Working, NOT Idle.
    await expect(
      workingLane.locator('.agent-card').filter({ hasText: 'Status Probe' })
    ).toHaveCount(1, { timeout: 15_000 });
    await expect(
      idleLane.locator('.agent-card').filter({ hasText: 'Status Probe' })
    ).toHaveCount(0);
  } finally {
    // Kill the stub session and leave no trace in the real ~/.zcc.
    await window.evaluate(async (args) => {
      const { pid, sid } = args as { pid: string; sid: string | null };
      try {
        if (sid) await window.cc.terminals.close(sid);
      } catch {
        /* best-effort */
      }
      try {
        await window.cc.projects.remove(pid);
      } catch {
        /* best-effort */
      }
    }, { pid: projectId, sid: sessionId });
  }
});
