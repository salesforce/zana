/**
 * Auto-close-idle NEVER reaps a team ORCHESTRATOR — real Electron boundary.
 *
 * Regression net for the "blocked question vanished" bug: with auto-close-idle
 * ON, the idle timer reaped the team ORCHESTRATOR while it sat idle (which is
 * exactly what a lead does whenever the job is at rest — including while it is
 * BLOCKED waiting on a human answer). Closing the lead tore the whole cohort
 * down: the "Needs you" badge and the drawer question disappeared, and only an
 * "Auto-closed" breadcrumb was left.
 *
 * The fix wires the session's cohort ROLE through `getSession` into
 * `AutoCloseIdleService.eligible()` (and the `close_idle_agents` peer resolver),
 * where an `orchestrator` is now unconditionally spared. This spec proves that
 * wiring at the PRODUCTION boundary (CLAUDE.md #8): unit tests can fake
 * `cohortRole`, but only a booted app proves `s.cohort?.role` actually reaches
 * the service from a real launch.
 *
 * We launch via the EPHEMERAL team path (`window.cc.teams.launch`), not the
 * durable Job Team (`teams.startJob`): the durable execution store encrypts
 * records via Electron `safeStorage`, which is unavailable in the sandboxed e2e
 * HOME (no Keychain), so a durable job can never spawn here. The ephemeral path
 * has ZERO encryption dependency yet stamps the SAME host-set
 * `cohort.role: 'orchestrator'` on the lead session — which is the exact field
 * the exemption reads. So this proves the wiring the fix depends on.
 *
 * Shape (all main-authoritative IPC, no timer mocking — the real 1-minute floor
 * elapses):
 *   1. Enable auto-close-idle at its 1-minute floor + launch an ephemeral team.
 *   2. Spawn a PLAIN control agent in the same project (the positive control).
 *   3. Both settle to `idle` (the fake stub emits the idle OSC title).
 *   4. Wait until the timer fires: the plain control agent IS reaped — proving
 *      the timer armed and is closing eligible idle agents in this window.
 *   5. Assert the orchestrator SURVIVED: its session is still live. Without the
 *      cohort-role gate the lead would have been closed in the same sweep.
 *
 * The orchestrator is a claude-family persona pointed at a fake stub so it
 * spawns with no model call. The fixture snapshots/restores ~/.zcc; we close the
 * sessions and remove the tmp project in `finally`.
 */
import { test, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ e2e: true });

// The auto-close dwell has a hard 1-minute floor (`Math.max(1, …) * 60_000`), so
// this spec must outlast a real minute plus spawn + settle + poll margin.
test.setTimeout(180_000);

test('auto-close-idle spares a team orchestrator but still reaps a plain idle agent', async ({
  app
}) => {
  const { window } = app;

  const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-autoclose-orch-'));
  let projectId: string | null = null;

  try {
    // Auto-close ON at the 1-minute floor; point the claude profile at the fake
    // stub. No inbox-notify needed for the assertion.
    await window.evaluate((bin) => window.cc.config.set({
      autoCloseIdleEnabled: true,
      autoCloseIdleMinutes: 1,
      sponsorPromptDismissed: true,
      claudeBinary: bin,
      defaultHarness: 'claude'
    }), agent.path);

    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-orchestrator',
      name: 'E2E Orchestrator',
      description: 'Claude orchestrator for the auto-close exemption spec',
      baseProfile: 'claude',
      permissionMode: 'default',
      systemPrompt: ''
    }));

    await window.evaluate(() => window.cc.teams.save({
      id: 'e2e-autoclose-team',
      name: 'E2E Auto-close Team',
      description: 'Ephemeral team under the auto-close exemption test',
      slots: [{ personaId: 'e2e-orchestrator' }],
      orchestratorPersonaId: 'e2e-orchestrator'
    }));

    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
        id: string;
      };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    // Neither test session is the foreground tab — pin the advisory active-session
    // to a bogus id so the foreground SPARE can never mask what we're testing. (We
    // never open either tab in the DOM, so the renderer won't report them either.)
    await window.evaluate(() => window.cc.terminals.setActiveSession('e2e-no-foreground'));
    await window.evaluate(() => window.cc.terminals.setFavorites([]));

    // 1. Launch the EPHEMERAL team (`teams.launch`) — an in-memory, unencrypted
    //    team lifecycle with no execution record, so it spawns the lead with the
    //    host-set `cohort.role: 'orchestrator'` stamp without touching safeStorage
    //    (unavailable in the e2e sandbox). This is the intact interactive-team
    //    launch the Squads panel's Launch button uses.
    await window.evaluate(async (pid) => {
      await window.cc.teams.launch('e2e-autoclose-team', pid);
    }, projectId);

    // Resolve the live orchestrator SESSION directly from main's own session list
    // by its cohort role (the host launch stamp) — main-owned (Rule 1); we never
    // trust renderer input.
    await expect
      .poll(async () => window.evaluate(async (pid) => {
        const sessions = (await window.cc.terminals.list(pid)) as Array<{
          cohort?: { role?: string };
        }>;
        return sessions.some((s) => s.cohort?.role === 'orchestrator');
      }, projectId), { timeout: 45_000 })
      .toBe(true);
    const orchestratorSessionId = await window.evaluate(async (pid) => {
      const sessions = (await window.cc.terminals.list(pid)) as Array<{
        id: string;
        cohort?: { role?: string };
      }>;
      return sessions.find((x) => x.cohort?.role === 'orchestrator')?.id ?? null;
    }, projectId);
    expect(orchestratorSessionId).toBeTruthy();

    // 2. Spawn a PLAIN control agent in the same project — the positive control
    //    that MUST be reaped, proving the timer armed and is firing in this window.
    const controlSessionId = await window.evaluate(async (pid) => {
      const res = await window.cc.terminals.create({
        projectId: pid,
        profile: 'claude',
        cols: 80,
        rows: 24,
        title: 'Plain control agent'
      });
      const s = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string };
      return s.id;
    }, projectId);
    expect(controlSessionId).toBeTruthy();
    expect(controlSessionId).not.toBe(orchestratorSessionId);

    // 3. Both settle to `idle` (the stub emits the idle OSC title after ~1s), which
    //    arms the auto-close timer for each on the working→idle edge.
    await expect
      .poll(async () => window.evaluate(async (ids) => {
        const pairs = (await window.cc.terminals.agentStatusSnapshot()) as Array<[string, string]>;
        const map = new Map(pairs);
        return map.get(ids.orch) === 'idle' && map.get(ids.ctrl) === 'idle';
      }, { orch: orchestratorSessionId, ctrl: controlSessionId }), { timeout: 30_000 })
      .toBe(true);

    // 4. Wait out the real 1-minute dwell: the PLAIN control agent is reaped
    //    (drops from the live session list once closeExpected → exit lands). Keep
    //    the foreground pinned to the bogus id across the wait so a stray renderer
    //    report can't spare either session.
    await expect
      .poll(async () => window.evaluate(async (ids) => {
        await window.cc.terminals.setActiveSession('e2e-no-foreground');
        const sessions = (await window.cc.terminals.list(ids.pid)) as Array<{ id: string; status?: string }>;
        const s = sessions.find((x) => x.id === ids.ctrl);
        return !s || s.status === 'exited';
      }, { pid: projectId, ctrl: controlSessionId }), { timeout: 100_000, intervals: [2_000] })
      .toBe(true);

    // 5. The orchestrator SURVIVED the same sweep: its session is still live.
    //    Without the cohort-role gate the lead would have been closed alongside
    //    the plain control agent. This is the fix.
    const orchestratorAlive = await window.evaluate(async (ids) => {
      const sessions = (await window.cc.terminals.list(ids.pid)) as Array<{ id: string; status?: string }>;
      const s = sessions.find((x) => x.id === ids.orch);
      return !!s && s.status !== 'exited';
    }, { pid: projectId, orch: orchestratorSessionId });
    expect(orchestratorAlive).toBe(true);
  } finally {
    // Teardown must never hang the test body (live sessions can make a naive close
    // loop stall), so close every tab and remove the project inside ONE evaluate
    // that races an internal deadline.
    if (projectId) {
      const pid = projectId;
      await window.evaluate(async (pid) => {
        const budget = new Promise<void>((resolve) => setTimeout(resolve, 8_000));
        const work = (async () => {
          try {
            const sessions = (await window.cc.terminals.list(pid)) as Array<{ id: string }> | undefined;
            for (const s of sessions ?? []) {
              try { await window.cc.terminals.close(s.id); } catch { /* best-effort */ }
            }
          } catch { /* best-effort */ }
          try { await window.cc.projects.remove(pid); } catch { /* best-effort */ }
        })();
        await Promise.race([work, budget]);
      }, pid).catch(() => { /* best-effort */ });
    }
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    agent.cleanup();
  }
});
